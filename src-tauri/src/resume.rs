//! Crash resume: if the app dies in the middle of a show, the next start offers
//! to pick up where it was (same show, same playhead, running cues at their spot).
//!
//! How: while the UI is in Run, a small background thread writes `resume.json`
//! in the data folder once a second (only when something plays or the playhead
//! moved). A clean exit deletes it. So if the file is there at start-up, the last
//! session ended badly while in Run.
//!
//! The engine thread never writes files (that could disturb audio timing); it only
//! drops a small `Snapshot` into a shared slot that this thread reads.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use cueplay_engine::show::Cue;
use cueplay_engine::{EngineState, Show};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    #[default]
    Build,
    Preflight,
    Run,
}

/// One cue that was playing, and where it was in its file (seconds).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeItem {
    pub cue_id: String,
    /// For the resume dialog; the UI may leave it out when sending items back.
    #[serde(default)]
    pub name: String,
    pub position: f64,
}

/// What `app_resume_info` returns (and what `resume.json` holds).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeInfo {
    pub show_path: String,
    pub playhead: Option<String>,
    pub running: Vec<ResumeItem>,
    pub saved_at_ms: u64,
}

/// What the engine thread shares ~30 times a second: enough to resume from.
#[derive(Debug, Clone, Default)]
pub struct Snapshot {
    pub playhead: Option<String>,
    pub running: Vec<ResumeItem>,
}

/// Finds a cue by id among the show's cues and its pads' cues.
pub fn find_cue(show: &Show, id: &str) -> Option<Cue> {
    show.cue(id).cloned().or_else(|| show.pads.iter().find(|p| p.cue.id == id).map(|p| p.cue.clone()))
}

/// Turns the engine's state into resume items. The engine reports positions
/// after trim; resuming needs the position in the file, so we add the trim back.
pub fn snapshot(show: &Show, state: &EngineState) -> Snapshot {
    let running = state
        .running
        .iter()
        .filter(|r| !r.stopping)
        .map(|r| {
            let trim_in = find_cue(show, &r.cue_id).map(|c| c.trim_in).unwrap_or(0.0);
            ResumeItem { cue_id: r.cue_id.clone(), name: r.name.clone(), position: trim_in + r.position }
        })
        .collect();
    Snapshot { playhead: state.playhead.clone(), running }
}

#[derive(Default)]
struct Session {
    show_path: Option<String>,
    mode: Mode,
}

/// Managed state for the resume commands and the writer thread.
pub struct ResumeState {
    path: PathBuf,
    session: Mutex<Session>,
    /// The resume file found at start-up (the crashed session), until dismissed.
    previous: Mutex<Option<ResumeInfo>>,
    /// Set on clean exit so the writer does not recreate the file afterwards.
    exiting: AtomicBool,
}

impl ResumeState {
    pub fn new(data_dir: &Path) -> Self {
        let path = data_dir.join("resume.json");
        let previous = std::fs::read_to_string(&path).ok().and_then(|t| serde_json::from_str(&t).ok());
        Self { path, session: Mutex::default(), previous: Mutex::new(previous), exiting: AtomicBool::new(false) }
    }

    pub fn set_session(&self, show_path: Option<String>, mode: Mode) {
        *lock(&self.session) = Session { show_path, mode };
    }

    pub fn previous(&self) -> Option<ResumeInfo> {
        lock(&self.previous).clone()
    }

    pub fn dismiss(&self) {
        *lock(&self.previous) = None;
        let _ = std::fs::remove_file(&self.path);
    }

    /// Clean exit: no resume offer next time.
    pub fn clean_exit(&self) {
        self.exiting.store(true, Ordering::SeqCst);
        let _ = std::fs::remove_file(&self.path);
    }

    /// Starts the once-a-second writer. `latest` is filled by the engine thread.
    pub fn spawn_writer(self: Arc<Self>, latest: Arc<Mutex<Snapshot>>) {
        std::thread::Builder::new()
            .name("cueplay-resume".into())
            .spawn(move || self.writer_loop(latest))
            .expect("could not start the resume thread");
    }

    fn writer_loop(&self, latest: Arc<Mutex<Snapshot>>) {
        let mut written: Option<Snapshot> = None;
        loop {
            std::thread::sleep(Duration::from_secs(1));
            if self.exiting.load(Ordering::SeqCst) {
                return;
            }
            let (show_path, mode) = {
                let s = lock(&self.session);
                (s.show_path.clone(), s.mode)
            };
            let Some(show_path) = show_path.filter(|_| mode == Mode::Run) else {
                // Left Run (or the show is unsaved): nothing to resume.
                if written.take().is_some() {
                    let _ = std::fs::remove_file(&self.path);
                }
                continue;
            };
            let snap = lock(&latest).clone();
            let playhead_moved = written.as_ref().is_none_or(|w| w.playhead != snap.playhead);
            if snap.running.is_empty() && !playhead_moved {
                continue;
            }
            let info = ResumeInfo {
                show_path,
                playhead: snap.playhead.clone(),
                running: snap.running.clone(),
                saved_at_ms: SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0),
            };
            if write_atomic(&self.path, &info).is_ok() {
                written = Some(snap);
            }
        }
    }
}

/// Temp file + rename, so a crash mid-write never leaves half a file.
fn write_atomic(path: &Path, info: &ResumeInfo) -> std::io::Result<()> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec(info).unwrap_or_default())?;
    std::fs::rename(&tmp, path)
}

/// A poisoned lock (a thread panicked while holding it) still holds usable data.
fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}
