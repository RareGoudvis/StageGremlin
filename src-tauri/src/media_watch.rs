//! Watches the show's `media/` folder, so the UI hears when an audio file is
//! changed (re-analyse it), removed (mark the cue missing) or added.
//!
//! Editors and copy tools fire many events per file (create, several writes,
//! rename…). We collect them and only report a path once it has been quiet for
//! 500 ms, with its final state: gone = "removed", new = "created", else "modified".

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::AnalysisCache;

const QUIET: Duration = Duration::from_millis(500);

/// Payload of `media://changed`.
#[derive(Debug, Clone, Serialize)]
struct MediaChanged {
    path: String,
    kind: &'static str,
}

/// Managed state: the current watcher (dropping it stops watching) and the
/// channel into the debounce thread.
pub struct MediaWatch {
    watcher: Mutex<Option<RecommendedWatcher>>,
    events: Sender<(PathBuf, bool)>,
}

impl MediaWatch {
    pub fn new(app: AppHandle) -> Self {
        let (events, rx) = mpsc::channel::<(PathBuf, bool)>();
        std::thread::Builder::new()
            .name("cueplay-media-watch".into())
            .spawn(move || {
                // path → (last event time, first event was a create)
                let mut waiting: HashMap<PathBuf, (Instant, bool)> = HashMap::new();
                loop {
                    match rx.recv_timeout(Duration::from_millis(100)) {
                        Ok((path, created)) => {
                            let entry = waiting.entry(path).or_insert((Instant::now(), created));
                            entry.0 = Instant::now();
                        }
                        Err(RecvTimeoutError::Timeout) => {}
                        Err(RecvTimeoutError::Disconnected) => return,
                    }
                    let ready: Vec<PathBuf> =
                        waiting.iter().filter(|(_, (t, _))| t.elapsed() >= QUIET).map(|(p, _)| p.clone()).collect();
                    for path in ready {
                        let (_, created) = waiting.remove(&path).unwrap_or((Instant::now(), false));
                        report(&app, &path, created);
                    }
                }
            })
            .expect("could not start the media watcher thread");
        Self { watcher: Mutex::new(None), events }
    }

    /// Watches `<show folder>/media`; `None` stops watching.
    pub fn watch(&self, show_dir: Option<&Path>) -> Result<(), String> {
        let mut slot = self.watcher.lock().unwrap_or_else(|e| e.into_inner());
        *slot = None; // stop the old watch first
        let Some(dir) = show_dir else { return Ok(()) };
        let media = dir.join("media");
        std::fs::create_dir_all(&media).map_err(|e| format!("Cannot create {}: {e}", media.display()))?;

        let tx = self.events.clone();
        let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            let Ok(event) = res else { return };
            let created = matches!(event.kind, EventKind::Create(_));
            if matches!(event.kind, EventKind::Access(_)) {
                return; // reading a file (e.g. playing it) is not a change
            }
            for path in event.paths {
                let _ = tx.send((path, created));
            }
        })
        .map_err(|e| format!("Cannot watch {}: {e}", media.display()))?;
        watcher.watch(&media, RecursiveMode::Recursive).map_err(|e| format!("Cannot watch {}: {e}", media.display()))?;
        *slot = Some(watcher);
        Ok(())
    }
}

fn report(app: &AppHandle, path: &Path, created: bool) {
    if path.is_dir() {
        return;
    }
    let kind = if !path.exists() {
        "removed"
    } else if created {
        "created"
    } else {
        "modified"
    };
    // A changed file must be analysed again, not served from the cache.
    if let Some(cache) = app.try_state::<AnalysisCache>() {
        cache.forget(path);
    }
    let _ = app.emit("media://changed", MediaChanged { path: path.display().to_string(), kind });
}
