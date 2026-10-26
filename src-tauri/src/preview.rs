//! Headphone preview: a second, separate engine on its own thread and its own
//! output device, so the operator can listen to a cue (or a swap candidate)
//! without it ever reaching the hall. It shares nothing with the show engine:
//! a stuck preview can never delay GO.
//!
//! By default it plays on the Windows default output. If that happens to be the
//! same device as the show output, `preview://state` says so (`sameAsShow`), so
//! the UI can warn "preview would go to the hall!".

use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use cueplay_engine::devices;
use cueplay_engine::kira::{AudioManagerSettings, DefaultBackend};
use cueplay_engine::show::Cue;
use cueplay_engine::{Engine, Show};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::engine_thread::OutputStatus;
use crate::outputs::picked_name;

type Reply = Sender<Result<(), String>>;

enum Msg {
    Play { cue: Box<Cue>, base_dir: Option<PathBuf>, at: f64, reply: Reply },
    Stop,
    SetOutput(Option<String>),
}

/// Payload of `preview://state`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewState {
    pub playing: bool,
    pub name: Option<String>,
    pub position: f64,
    pub length: f64,
    /// Device the preview plays on.
    pub output_name: String,
    /// True when that is also the show output: preview would be heard in the hall.
    pub same_as_show: bool,
}

const TICK: Duration = Duration::from_millis(10);
const STATE_EVERY: Duration = Duration::from_millis(100);
const RETRY_EVERY: Duration = Duration::from_secs(2);

pub struct PreviewHandle {
    tx: Sender<Msg>,
}

impl PreviewHandle {
    /// `show_output` is the show engine's output slot, to spot "same device".
    pub fn spawn(app: AppHandle, preferred: Option<String>, show_output: Arc<Mutex<Option<OutputStatus>>>) -> Self {
        let (tx, rx) = mpsc::channel();
        std::thread::Builder::new()
            .name("cueplay-preview".into())
            .spawn(move || preview_loop(app, rx, preferred, show_output))
            .expect("could not start the preview thread");
        Self { tx }
    }

    /// Plays `cue` from `at` seconds into its file, replacing any running preview.
    pub fn play(&self, cue: Cue, base_dir: Option<PathBuf>, at: f64) -> Result<(), String> {
        let (reply, answer) = mpsc::channel();
        self.tx
            .send(Msg::Play { cue: Box::new(cue), base_dir, at, reply })
            .map_err(|_| "The preview player has stopped.".to_string())?;
        answer
            .recv_timeout(Duration::from_secs(3))
            .unwrap_or_else(|_| Err("The preview player did not respond.".to_string()))
    }

    pub fn stop(&self) {
        let _ = self.tx.send(Msg::Stop);
    }

    pub fn set_output(&self, preferred: Option<String>) {
        let _ = self.tx.send(Msg::SetOutput(preferred));
    }
}

struct Preview {
    app: AppHandle,
    engine: Option<Engine<DefaultBackend>>,
    preferred: Option<String>,
    output_name: String,
    show_output: Arc<Mutex<Option<OutputStatus>>>,
    last_attempt: Option<Instant>,
    was_playing: bool,
    /// Trim-in of the cue being previewed, so the reported position is a file position
    /// (the same unit the UI uses for `at` and the waveform).
    trim_in: f64,
}

fn preview_loop(app: AppHandle, rx: Receiver<Msg>, preferred: Option<String>, show_output: Arc<Mutex<Option<OutputStatus>>>) {
    let mut p = Preview {
        app,
        engine: None,
        preferred,
        output_name: String::new(),
        show_output,
        last_attempt: None,
        was_playing: false,
        trim_in: 0.0,
    };
    let mut last_tick = Instant::now();
    let mut last_state = Instant::now();
    loop {
        p.ensure_engine();
        match rx.recv_timeout(TICK) {
            Ok(msg) => p.handle(msg),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
        let now = Instant::now();
        if let Some(engine) = &mut p.engine {
            engine.tick(now.duration_since(last_tick).as_secs_f64());
        }
        last_tick = now;
        if now.duration_since(last_state) >= STATE_EVERY {
            last_state = now;
            p.emit_state(false);
        }
    }
}

impl Preview {
    fn ensure_engine(&mut self) {
        if self.engine.is_some() || self.last_attempt.is_some_and(|t| t.elapsed() < RETRY_EVERY) {
            return;
        }
        self.last_attempt = Some(Instant::now());
        let (backend_settings, found) = devices::settings_for(self.preferred.as_deref());
        let settings = AudioManagerSettings::<DefaultBackend> { backend_settings, ..Default::default() };
        if let Ok(engine) = Engine::new(settings, -1.0) {
            self.engine = Some(engine);
            self.output_name = picked_name(self.preferred.as_deref(), found);
            self.emit_state(true);
        }
    }

    fn handle(&mut self, msg: Msg) {
        match msg {
            Msg::Play { cue, base_dir, at, reply } => {
                let Some(engine) = &mut self.engine else {
                    let _ = reply.send(Err("No preview output available.".to_string()));
                    return;
                };
                engine.panic(); // stop the previous preview (5 ms, no click)
                // The engine resolves the cue's file against the show folder.
                engine.set_show(Show::default(), base_dir);
                self.trim_in = cue.trim_in;
                let _ = reply.send(engine.play_one(&cue, at));
            }
            Msg::Stop => {
                if let Some(engine) = &mut self.engine {
                    engine.stop_all();
                }
            }
            Msg::SetOutput(preferred) => {
                self.preferred = preferred;
                self.engine = None; // frees the old device; ensure_engine builds the new one
                self.last_attempt = None;
            }
        }
    }

    /// ~10 Hz while playing, once when it stops, and once when the output changes.
    fn emit_state(&mut self, force: bool) {
        let Some(engine) = &mut self.engine else { return };
        let state = engine.state();
        let current = state.running.iter().rev().find(|r| !r.stopping);
        let playing = current.is_some();
        if !playing && !self.was_playing && !force {
            return;
        }
        self.was_playing = playing;
        let same_as_show = self
            .show_output
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .is_some_and(|s| s.output_name == self.output_name);
        let payload = PreviewState {
            playing,
            name: current.map(|r| r.name.clone()),
            position: current.map_or(0.0, |r| self.trim_in + r.position),
            length: current.map_or(0.0, |r| r.length),
            output_name: self.output_name.clone(),
            same_as_show,
        };
        let _ = self.app.emit("preview://state", payload);
    }
}
