//! The audio engine runs on one dedicated thread that owns it.
//!
//! Why: kira's AudioManager is not meant to be shared between threads, and a lock
//! around it would let a slow UI request hold up playback timing. Instead the
//! Tauri commands post messages to this thread and (when they need an answer)
//! wait briefly for the reply. Nothing else ever touches the engine.
//!
//! The loop:
//!   1. wait up to 5 ms for a message, handle it, then handle any others queued up
//!   2. `engine.tick(dt)` with the real time that passed (pre-waits, follows, fades)
//!   3. every ~33 ms send `engine://state` to the UI (meters, timers, log)
//!
//! Audio output: the operator picks a preferred device by (part of) its name,
//! "Qu-24" by default. If it is not plugged in, we play on the Windows default
//! output and look for the preferred one again every 2 s while nothing is playing,
//! so plugging the Qu-24 in before the show switches over by itself.
//!
//! USB dropout during the show: kira itself moves the running sound to the
//! Windows default output when the device disappears (sounds keep their place).
//! We mark the output as "not found", log it and tell the UI. As a safety net,
//! if the sound has not moved on 1.5 s later, we rebuild the engine on the
//! default output and restart what was playing at the positions we last saw.
//!
//! If no audio device works at all, the thread keeps retrying every 2 s. The UI
//! still gets idle states so it does not freeze, and commands that need sound
//! return a readable error.

use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use cueplay_engine::devices;
use cueplay_engine::dsp::MeterReading;
use cueplay_engine::kira::backend::cpal::cpal::ErrorKind;
use cueplay_engine::kira::{AudioManagerSettings, DefaultBackend};
use cueplay_engine::{Engine, EngineState, Show};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::outputs::picked_name;
use crate::resume::{self, ResumeItem, Snapshot};

pub type AudioEngine = Engine<DefaultBackend>;

/// Work for the engine thread. `Run` carries a small job ("call go()", "stop cue X").
enum Msg {
    SetShow(Show, Option<PathBuf>),
    SetOutput(Option<String>),
    Run(Box<dyn FnOnce(&mut AudioEngine) + Send>),
}

/// Payload of the `engine://output` event: which device we actually play on.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputStatus {
    /// Name of the device sound is going to right now.
    pub output_name: String,
    /// False when the preferred device is missing and we fell back to the default.
    pub output_found: bool,
    /// What the operator asked for (`null` = Windows default).
    pub preferred: Option<String>,
}

const TICK: Duration = Duration::from_millis(5);
const STATE_EVERY: Duration = Duration::from_millis(33);
const RETRY_EVERY: Duration = Duration::from_secs(2);
/// After a dropout, how long we give kira to carry on by itself.
const DROPOUT_GRACE: Duration = Duration::from_millis(1500);
/// A command never waits longer than this for the engine thread to answer.
const REPLY_TIMEOUT: Duration = Duration::from_secs(2);

const NO_DEVICE: &str = "No audio output available. Check that the sound card or mixer (Qu-24) is connected; RG CuePlay keeps retrying.";
const STOPPED: &str = "The audio engine has stopped. Please restart RG CuePlay.";

/// What the Tauri commands hold (as managed state) to talk to the engine thread.
pub struct EngineHandle {
    tx: Sender<Msg>,
    /// Latest output status, so the UI can ask for it after start-up
    /// (the first `engine://output` event may fire before the UI listens).
    output: Arc<Mutex<Option<OutputStatus>>>,
    /// Latest playhead and running cues, for the crash-resume writer.
    snapshot: Arc<Mutex<Snapshot>>,
}

impl EngineHandle {
    /// Starts the engine thread. It runs until the app exits.
    pub fn spawn(app: AppHandle, preferred_output: Option<String>) -> Self {
        let (tx, rx) = mpsc::channel();
        let output = Arc::new(Mutex::new(None));
        let snapshot = Arc::new(Mutex::new(Snapshot::default()));
        let shared = Shared { output: output.clone(), snapshot: snapshot.clone() };
        std::thread::Builder::new()
            .name("cueplay-engine".into())
            .spawn(move || engine_loop(app, rx, preferred_output, shared))
            .expect("could not start the audio engine thread");
        Self { tx, output, snapshot }
    }

    /// Hands the engine a new copy of the show. Always accepted, even without an
    /// audio device: the thread remembers it and loads it once the device appears.
    pub fn set_show(&self, show: Show, base_dir: Option<PathBuf>) -> Result<(), String> {
        self.tx.send(Msg::SetShow(show, base_dir)).map_err(|_| STOPPED.to_string())
    }

    /// Switches to another output device. This rebuilds the engine, which cuts
    /// anything playing, so the UI should only offer it outside Run mode.
    pub fn set_output(&self, preferred: Option<String>) -> Result<(), String> {
        self.tx.send(Msg::SetOutput(preferred)).map_err(|_| STOPPED.to_string())
    }

    pub fn output_status(&self) -> Option<OutputStatus> {
        lock(&self.output).clone()
    }

    pub fn output_slot(&self) -> Arc<Mutex<Option<OutputStatus>>> {
        self.output.clone()
    }

    pub fn snapshot_slot(&self) -> Arc<Mutex<Snapshot>> {
        self.snapshot.clone()
    }

    /// Runs `job` on the engine thread and returns its result.
    /// If there is no engine (no audio device), the thread drops the job without
    /// running it; that closes the reply channel and we report "no audio output".
    pub fn run<T, F>(&self, job: F) -> Result<T, String>
    where
        T: Send + 'static,
        F: FnOnce(&mut AudioEngine) -> T + Send + 'static,
    {
        let (reply_tx, reply_rx) = mpsc::channel();
        let msg = Msg::Run(Box::new(move |engine| {
            let _ = reply_tx.send(job(engine));
        }));
        self.tx.send(msg).map_err(|_| STOPPED.to_string())?;
        match reply_rx.recv_timeout(REPLY_TIMEOUT) {
            Ok(value) => Ok(value),
            Err(RecvTimeoutError::Disconnected) => Err(NO_DEVICE.to_string()),
            Err(RecvTimeoutError::Timeout) => Err("The audio engine did not respond in time.".to_string()),
        }
    }
}

/// Starts each item at its file position (crash resume, dropout rescue).
/// Cues that no longer exist are skipped; everything is written to the show log.
pub fn resume_items(engine: &mut AudioEngine, items: &[ResumeItem], why: &str) {
    for item in items {
        let Some(cue) = resume::find_cue(engine.show(), &item.cue_id) else {
            engine.note("skip", format!("{why}: cue {} is no longer in the show", item.cue_id));
            continue;
        };
        match engine.play_one(&cue, item.position) {
            Ok(()) => engine.note(why, format!("{} {} from {:.1} s", cue.number, cue.name, item.position)),
            Err(e) => engine.note("skip", format!("{why}: {} {}: {e}", cue.number, cue.name)),
        }
    }
}

/// Slots the engine thread fills for the rest of the app to read.
struct Shared {
    output: Arc<Mutex<Option<OutputStatus>>>,
    snapshot: Arc<Mutex<Snapshot>>,
}

/// A dropout we are watching: what was playing, and when the device went.
struct DropoutWatch {
    since: Instant,
    /// Running instance → position (after trim) at the moment of the dropout.
    positions: Vec<(u64, f64)>,
    items: Vec<ResumeItem>,
}

/// Everything the engine thread keeps between loop turns.
struct Worker {
    app: AppHandle,
    engine: Option<AudioEngine>,
    /// Latest show from the UI, kept so a (re)created engine can be loaded with it.
    show: Show,
    base_dir: Option<PathBuf>,
    /// Part of the device name the operator wants ("Qu-24"); `None` = default.
    preferred: Option<String>,
    /// Whether the current engine plays on the preferred device.
    output_found: bool,
    /// After a dropout: build the next engine on the default output, not the preferred one.
    force_default: bool,
    dropout: Option<DropoutWatch>,
    last_state: Option<EngineState>,
    shared: Shared,
    /// Last time we tried to create the engine or looked for the preferred device.
    last_attempt: Option<Instant>,
    last_error: Option<String>,
    /// Clock for the idle states sent while there is no engine.
    idle_clock: f64,
}

fn engine_loop(app: AppHandle, rx: Receiver<Msg>, preferred: Option<String>, shared: Shared) {
    // This thread lives as long as the app, so the "stay awake" request does too.
    crate::keep_awake::keep_awake();

    let mut w = Worker {
        app,
        engine: None,
        show: Show::default(),
        base_dir: None,
        preferred,
        output_found: false,
        force_default: false,
        dropout: None,
        last_state: None,
        shared,
        last_attempt: None,
        last_error: None,
        idle_clock: 0.0,
    };
    let mut last_tick = Instant::now();
    let mut last_state = Instant::now();

    loop {
        w.ensure_engine();

        // Waiting on the channel (instead of sleeping) means GO is handled the
        // moment it arrives, not up to 5 ms later.
        match rx.recv_timeout(TICK) {
            Ok(msg) => w.handle(msg),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break, // app is closing
        }
        while let Ok(msg) = rx.try_recv() {
            w.handle(msg);
        }

        let now = Instant::now();
        let dt = now.duration_since(last_tick).as_secs_f64();
        last_tick = now;
        w.tick(dt);

        if now.duration_since(last_state) >= STATE_EVERY {
            last_state = now;
            w.emit_state();
        }
    }
}

impl Worker {
    /// Creates the engine if there is none, at most once every 2 seconds.
    fn ensure_engine(&mut self) {
        if self.engine.is_some() || self.last_attempt.is_some_and(|t| t.elapsed() < RETRY_EVERY) {
            return;
        }
        self.last_attempt = Some(Instant::now());

        // Pick the preferred device if it is there, otherwise the default one.
        let wish = if self.force_default { None } else { self.preferred.as_deref() };
        let (backend_settings, found) = devices::settings_for(wish);
        let found = found && !self.force_default;
        let settings = AudioManagerSettings::<DefaultBackend> { backend_settings, ..Default::default() };
        match Engine::new(settings, self.show.settings.limiter_ceiling_db) {
            Ok(mut engine) => {
                engine.set_show(self.show.clone(), self.base_dir.clone());
                self.engine = Some(engine);
                self.output_found = found;
                self.last_error = None;
                self.publish_output();
            }
            Err(e) => {
                let text = format!("{NO_DEVICE} ({e})");
                // Only tell the UI when the problem changes, not every 2 seconds.
                if self.last_error.as_deref() != Some(text.as_str()) {
                    let _ = self.app.emit("engine://error", text.clone());
                    self.last_error = Some(text);
                }
            }
        }
    }

    /// Tells the UI which device we play on (`engine://output`) and remembers it.
    fn publish_output(&mut self) {
        let name = picked_name(self.preferred.as_deref(), self.output_found);
        let status = OutputStatus { output_name: name, output_found: self.output_found, preferred: self.preferred.clone() };
        *lock(&self.shared.output) = Some(status.clone());
        let _ = self.app.emit("engine://output", status);
    }

    fn handle(&mut self, msg: Msg) {
        match msg {
            Msg::SetShow(show, base_dir) => {
                self.show = show.clone();
                self.base_dir = base_dir.clone();
                if let Some(engine) = &mut self.engine {
                    engine.set_show(show, base_dir);
                }
            }
            Msg::SetOutput(preferred) => {
                // An explicit choice from the operator: switch now.
                self.preferred = preferred;
                self.force_default = false;
                self.rebuild();
                if self.engine.is_none() {
                    // Rebuild failed; still report the new wish to the UI.
                    self.output_found = false;
                    self.publish_output();
                }
            }
            Msg::Run(job) => {
                if let Some(engine) = &mut self.engine {
                    job(engine);
                }
                // No engine: `job` is dropped here, the caller sees "no audio output".
            }
        }
    }

    fn tick(&mut self, dt: f64) {
        let Some(engine) = &mut self.engine else {
            self.idle_clock += dt;
            return;
        };
        engine.tick(dt);

        // Errors the audio backend ran into since the last turn.
        let mut device_lost = false;
        while let Some(err) = engine.backend_mut().pop_error() {
            if matches!(err.kind(), ErrorKind::DeviceNotAvailable | ErrorKind::StreamInvalidated) {
                device_lost = true;
            } else {
                let _ = self.app.emit("engine://error", format!("Audio device problem: {err}"));
            }
        }
        if device_lost {
            self.on_device_lost();
        }

        self.check_dropout();
        self.switch_back_when_idle();
    }

    /// The output device vanished (USB cable, mixer switched off).
    fn on_device_lost(&mut self) {
        // Already on the fallback: kira follows the Windows default by itself.
        if self.force_default && !self.output_found {
            return;
        }
        let lost = picked_name(self.preferred.as_deref(), self.output_found);
        let was_preferred = self.output_found && self.preferred.is_some();
        self.output_found = false;
        self.force_default = true;
        let text = format!("Lost audio output \"{lost}\": switched to the Windows default output.");
        if let Some(engine) = &mut self.engine {
            engine.note("output", text.clone());
        }
        let _ = self.app.emit("engine://error", text);
        self.publish_output();

        // Remember what was playing, to check in a moment that it still moves.
        if let (Some(state), Some(engine)) = (&self.last_state, &self.engine) {
            if !state.running.is_empty() && was_preferred {
                self.dropout = Some(DropoutWatch {
                    since: Instant::now(),
                    positions: state.running.iter().map(|r| (r.instance, r.position)).collect(),
                    items: resume::snapshot(engine.show(), state).running,
                });
            }
        }
    }

    /// Safety net after a dropout: if no running cue has moved on since, kira did
    /// not manage to carry on, so we rebuild on the default output and restart.
    fn check_dropout(&mut self) {
        let Some(watch) = &self.dropout else { return };
        if watch.since.elapsed() < DROPOUT_GRACE {
            return;
        }
        let watch = self.dropout.take().unwrap();
        let moved = self.last_state.as_ref().is_some_and(|s| {
            s.running.iter().any(|r| watch.positions.iter().any(|(i, p)| *i == r.instance && (r.position - p).abs() > 0.05))
        });
        if moved {
            return;
        }
        self.rebuild();
        if let Some(engine) = &mut self.engine {
            resume_items(engine, &watch.items, "rescue");
        }
    }

    /// Every 2 s while nothing plays: if the preferred device is (back) there and
    /// we are not on it, switch to it. A rebuild cuts sound, hence "while idle".
    fn switch_back_when_idle(&mut self) {
        let Some(engine) = &self.engine else { return };
        if engine.is_playing() || engine.tone_playing() || self.output_found || self.preferred.is_none() {
            return;
        }
        if self.last_attempt.is_some_and(|t| t.elapsed() < RETRY_EVERY) {
            return;
        }
        self.last_attempt = Some(Instant::now());
        if devices::settings_for(self.preferred.as_deref()).1 {
            self.force_default = false;
            self.rebuild();
            if self.output_found {
                if let Some(engine) = &mut self.engine {
                    engine.note("output", format!("Back on \"{}\".", picked_name(self.preferred.as_deref(), true)));
                }
            }
        }
    }

    /// Replaces the engine with a fresh one (same show, same playhead).
    fn rebuild(&mut self) {
        let playhead = self.engine.as_ref().and_then(|e| e.playhead().map(str::to_string));
        // Drop the old engine first so the audio device is free for the new one.
        self.engine = None;
        self.last_attempt = None;
        self.ensure_engine();
        if let (Some(engine), Some(id)) = (&mut self.engine, playhead) {
            engine.set_playhead(Some(id));
        }
    }

    fn emit_state(&mut self) {
        let state = match &mut self.engine {
            Some(engine) => {
                let state = engine.state();
                *lock(&self.shared.snapshot) = resume::snapshot(engine.show(), &state);
                state
            }
            // No device: send an empty state so meters fall back and timers clear.
            None => EngineState {
                clock: self.idle_clock,
                playhead: self.show.first_in_queue().map(|c| c.id.clone()),
                running: vec![],
                pending: vec![],
                meter: MeterReading::default(),
                new_log: vec![],
            },
        };
        let _ = self.app.emit("engine://state", &state);
        self.last_state = Some(state);
    }
}

/// A poisoned lock (a thread panicked while holding it) still holds usable data.
fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}
