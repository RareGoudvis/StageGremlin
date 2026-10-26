//! The Tauri commands the UI calls with `invoke(...)`. The contract is docs/ipc.md.
//!
//! Tauri turns the camelCase argument names from JavaScript (`cueId`, `baseDir`)
//! into the snake_case Rust names below (`cue_id`, `base_dir`) automatically.
//! Errors go back to the UI as readable strings.
//!
//! The commands are `async` so Tauri runs them off the window's main thread:
//! waiting for the engine thread or decoding a file never freezes the UI.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use cueplay_engine::analysis::{self, Analysis};
use cueplay_engine::devices::{self, OutputDevice};
use cueplay_engine::show::Cue;
use cueplay_engine::tone::ToneKind;
use cueplay_engine::{show, GoResult, Show};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::engine_thread::{self, EngineHandle, OutputStatus};
use crate::files;
use crate::media_watch::MediaWatch;
use crate::preview::PreviewHandle;
use crate::resume::{Mode, ResumeInfo, ResumeItem, ResumeState};
use crate::settings;
use crate::yt::{self, DownloadItem, Format, Tool, Yt, YtItem, YtStatus};

/// Remembers analyses so re-adding the same file is instant.
/// Keyed by path; the file's modified time tells us when it changed on disk.
#[derive(Default)]
pub struct AnalysisCache(Mutex<HashMap<PathBuf, (SystemTime, Analysis)>>);

impl AnalysisCache {
    /// Drops a file's cached analysis (the media watcher saw it change).
    pub fn forget(&self, path: &Path) {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).remove(path);
    }
}

/// Facts about this install, for the About box and the title bar.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub portable: bool,
    pub data_dir: String,
    /// The release tag this build was made as (e.g. "v0.1.0-build.9"); None in dev builds.
    pub build: Option<String>,
}

/// Engine errors also go out as an `engine://error` event, so the operator sees
/// them even when the UI code that called the command ignores the result.
fn report<T>(app: &AppHandle, result: Result<T, String>) -> Result<T, String> {
    if let Err(e) = &result {
        let _ = app.emit("engine://error", e.clone());
    }
    result
}

// ---- engine ----

#[tauri::command]
pub async fn engine_set_show(engine: State<'_, EngineHandle>, show: Show, base_dir: Option<String>) -> Result<(), String> {
    engine.set_show(show, base_dir.map(PathBuf::from))
}

/// Returns "fired", "ignored" (double-press protection) or "endOfShow".
#[tauri::command]
pub async fn engine_go(app: AppHandle, engine: State<'_, EngineHandle>) -> Result<GoResult, String> {
    report(&app, engine.run(|e| e.go()))
}

#[tauri::command]
pub async fn engine_stop_all(app: AppHandle, engine: State<'_, EngineHandle>) -> Result<(), String> {
    report(&app, engine.run(|e| e.stop_all()))
}

#[tauri::command]
pub async fn engine_panic(app: AppHandle, engine: State<'_, EngineHandle>) -> Result<(), String> {
    report(&app, engine.run(|e| e.panic()))
}

#[tauri::command]
pub async fn engine_stop_cue(app: AppHandle, engine: State<'_, EngineHandle>, cue_id: String) -> Result<(), String> {
    report(&app, engine.run(move |e| e.stop_cue(&cue_id)))
}

/// `cue_id` null = the most recently started cue.
#[tauri::command]
pub async fn engine_toggle_under(app: AppHandle, engine: State<'_, EngineHandle>, cue_id: Option<String>) -> Result<(), String> {
    report(&app, engine.run(move |e| e.toggle_under(cue_id.as_deref())))
}

/// `cue_id` null = every vamping cue.
#[tauri::command]
pub async fn engine_release_vamp(app: AppHandle, engine: State<'_, EngineHandle>, cue_id: Option<String>) -> Result<(), String> {
    report(&app, engine.run(move |e| e.release_vamp(cue_id.as_deref())))
}

/// P: pause everything that plays (and its timers), or resume it.
#[tauri::command]
pub async fn engine_pause_all(app: AppHandle, engine: State<'_, EngineHandle>) -> Result<bool, String> {
    let r = engine.run(move |e| e.toggle_pause_all());
    if let Err(err) = &r {
        let _ = app.emit("engine://error", err.clone());
    }
    r
}

/// Master fader in dB (0 = unity, -60 = off). Applied before the limiter.
#[tauri::command]
pub async fn engine_set_master(app: AppHandle, engine: State<'_, EngineHandle>, db: f64) -> Result<(), String> {
    report(&app, engine.run(move |e| e.set_master_db(db)))
}

#[tauri::command]
pub async fn engine_set_playhead(app: AppHandle, engine: State<'_, EngineHandle>, cue_id: Option<String>) -> Result<(), String> {
    report(&app, engine.run(move |e| e.set_playhead(cue_id)))
}

/// Soundboard pad press (keys 1–9, 0 in Run).
#[tauri::command]
pub async fn engine_pad(app: AppHandle, engine: State<'_, EngineHandle>, pad_id: String) -> Result<(), String> {
    report(&app, engine.run(move |e| e.play_pad(&pad_id)))
}

/// Rehearsal: start a cue `at` seconds into its file; the playhead moves past it.
#[tauri::command]
pub async fn engine_go_from(app: AppHandle, engine: State<'_, EngineHandle>, cue_id: String, at: f64) -> Result<(), String> {
    report(&app, engine.run(move |e| e.go_from(&cue_id, at)))
}

/// Preflight tone: "pink" (at the show's loudness target), "line" (1 kHz) or null = off.
#[tauri::command]
pub async fn engine_tone(app: AppHandle, engine: State<'_, EngineHandle>, kind: Option<ToneKind>) -> Result<(), String> {
    report(
        &app,
        engine.run(move |e| match kind {
            Some(kind) => {
                let target = e.show().settings.target_lufs;
                e.start_tone(kind, target);
            }
            None => e.stop_tone(),
        }),
    )
}

// ---- audio output ----

/// Every output device Windows reports, default first.
#[tauri::command]
pub async fn audio_list_outputs() -> Result<Vec<OutputDevice>, String> {
    // Asking Windows for its devices can take a moment; keep it off the UI thread.
    blocking(|| Ok(devices::list_outputs())).await
}

/// Picks the output by (part of) its name, e.g. "Qu-24"; `null` = Windows default.
/// Remembered on this machine. Rebuilds the engine, so it cuts running sound.
/// The result arrives as an `engine://output` event.
#[tauri::command]
pub async fn audio_set_output(info: State<'_, AppInfo>, engine: State<'_, EngineHandle>, name: Option<String>) -> Result<(), String> {
    let name = name.map(|n| n.trim().to_string()).filter(|n| !n.is_empty());
    settings::update(Path::new(&info.data_dir), |m| m.output_device = name.clone())?;
    engine.set_output(name)
}

/// The latest `engine://output` payload (`null` until the engine first started),
/// for a UI that starts listening after that event already went out.
#[tauri::command]
pub fn audio_output_status(engine: State<'_, EngineHandle>) -> Option<OutputStatus> {
    engine.output_status()
}

/// Picks the headphone-preview output by (part of) its name; null = Windows default.
#[tauri::command]
pub async fn audio_set_preview_output(
    info: State<'_, AppInfo>,
    preview: State<'_, PreviewHandle>,
    name: Option<String>,
) -> Result<(), String> {
    let name = name.map(|n| n.trim().to_string()).filter(|n| !n.is_empty());
    settings::update(Path::new(&info.data_dir), |m| m.preview_device = name.clone())?;
    preview.set_output(name);
    Ok(())
}

// ---- headphone preview ----

/// Plays one cue on the preview output from `at` seconds into its file.
/// Replaces whatever was previewing. Never touches the show output.
#[tauri::command]
pub async fn preview_play(preview: State<'_, PreviewHandle>, cue: Cue, base_dir: Option<String>, at: f64) -> Result<(), String> {
    preview.play(cue, base_dir.map(PathBuf::from), at)
}

#[tauri::command]
pub fn preview_stop(preview: State<'_, PreviewHandle>) {
    preview.stop();
}

// ---- crash resume ----

/// The UI tells us which show is open and which mode it is in (open/save/mode change).
#[tauri::command]
pub fn app_session(resume: State<'_, std::sync::Arc<ResumeState>>, show_path: Option<String>, mode: Mode) {
    resume.set_session(show_path, mode);
}

/// What was playing when the previous session crashed in Run (null if it ended cleanly).
#[tauri::command]
pub fn app_resume_info(resume: State<'_, std::sync::Arc<ResumeState>>) -> Option<ResumeInfo> {
    resume.previous()
}

#[tauri::command]
pub fn app_resume_dismiss(resume: State<'_, std::sync::Arc<ResumeState>>) {
    resume.dismiss();
}

/// Restarts these cues at these file positions (no fade-in). Each one is logged.
#[tauri::command]
pub async fn engine_resume(app: AppHandle, engine: State<'_, EngineHandle>, items: Vec<ResumeItem>) -> Result<(), String> {
    report(&app, engine.run(move |e| engine_thread::resume_items(e, &items, "resume")))
}

// ---- YouTube import and conversion ----

#[tauri::command]
pub async fn yt_status(yt: State<'_, Yt>) -> Result<YtStatus, String> {
    let bin = yt.bin_dir().to_path_buf();
    // Asks yt-dlp for its version: starts a process, so off the UI thread.
    blocking(move || Ok(yt::status(&bin))).await
}

/// Downloads yt-dlp or ffmpeg into `<dataDir>/bin`; progress via `yt://install`.
#[tauri::command]
pub async fn yt_install(app: AppHandle, yt: State<'_, Yt>, what: Tool) -> Result<(), String> {
    let bin = yt.bin_dir().to_path_buf();
    blocking(move || yt::install(&app, &bin, what)).await
}

/// Turns pasted lines (links, playlists, "artist – title") into videos.
#[tauri::command]
pub async fn yt_resolve(yt: State<'_, Yt>, lines: Vec<String>) -> Result<Vec<YtItem>, String> {
    let bin = yt.bin_dir().to_path_buf();
    blocking(move || yt::resolve(&bin, lines)).await
}

/// Queues downloads (2 at a time); progress via `yt://progress`.
#[tauri::command]
pub async fn yt_download(
    app: AppHandle,
    yt: State<'_, Yt>,
    items: Vec<DownloadItem>,
    format: Format,
    dest_dir: String,
) -> Result<(), String> {
    yt.enqueue(&app, items, format, PathBuf::from(dest_dir))
}

/// Converts a file the engine can't play (Opus, WebM) to M4A in `dest_dir`; returns the new path.
#[tauri::command]
pub async fn media_convert(yt: State<'_, Yt>, path: String, dest_dir: String) -> Result<String, String> {
    let bin = yt.bin_dir().to_path_buf();
    blocking(move || yt::convert(&bin, Path::new(&path), Path::new(&dest_dir))).await
}

// ---- show files ----

#[tauri::command]
pub async fn show_open(path: String) -> Result<Show, String> {
    blocking(move || show::load(Path::new(&path)).map_err(|e| e.to_string())).await
}

/// Saves the show; media outside the show folder is copied into `media/` and the
/// paths are rewritten. The UI must adopt the returned show.
#[tauri::command]
pub async fn show_save(path: String, show: Show) -> Result<Show, String> {
    blocking(move || {
        let mut show = show;
        show::save(Path::new(&path), &mut show).map_err(|e| e.to_string())?;
        Ok(show)
    })
    .await
}

/// Zips the show file (.sg, or an older .cueplay) and its media/ folder (not backups/) into `dest`.
#[tauri::command]
pub async fn show_export_zip(show_path: String, dest: String) -> Result<(), String> {
    blocking(move || files::export_zip(Path::new(&show_path), Path::new(&dest))).await
}

/// Watches `<dir>/media` (dir = the show folder) and sends `media://changed`; null = stop.
#[tauri::command]
pub fn media_watch(watch: State<'_, MediaWatch>, dir: Option<String>) -> Result<(), String> {
    watch.watch(dir.as_deref().map(Path::new))
}

/// For each path: does the file exist? (The UI marks missing cues.)
#[tauri::command]
pub async fn file_exists(paths: Vec<String>) -> Result<Vec<bool>, String> {
    blocking(move || Ok(paths.iter().map(|p| Path::new(p).is_file()).collect())).await
}

/// Opens Explorer with this file selected.
#[tauri::command]
pub fn show_in_folder(path: String) -> Result<(), String> {
    files::show_in_folder(Path::new(&path))
}

// ---- UI settings (per machine) ----

/// The UI's own settings object (`{}` the first time).
#[tauri::command]
pub fn settings_get(info: State<'_, AppInfo>) -> serde_json::Value {
    settings::load(&settings::path_in(Path::new(&info.data_dir))).ui
}

/// Merges `patch` into the UI settings (top-level keys; null removes a key) and returns the result.
#[tauri::command]
pub fn settings_set(info: State<'_, AppInfo>, patch: serde_json::Value) -> Result<serde_json::Value, String> {
    let saved = settings::update(Path::new(&info.data_dir), |m| settings::merge_ui(&mut m.ui, patch))?;
    Ok(saved.ui)
}

// ---- analysis ----

/// Measures loudness and draws the waveform overview. Slow (decodes the whole
/// file), so it runs on a background thread and the result is cached.
#[tauri::command]
pub async fn analyze_file(cache: State<'_, AnalysisCache>, base_dir: Option<String>, file: String) -> Result<Analysis, String> {
    // Same rule the engine uses to find a cue's file.
    let path = Show::default().resolve(base_dir.as_deref().map(Path::new), &file);
    let modified = std::fs::metadata(&path)
        .and_then(|m| m.modified())
        .map_err(|e| format!("Cannot open {}: {e}", path.display()))?;

    if let Some((when, hit)) = cache.0.lock().unwrap_or_else(|e| e.into_inner()).get(&path) {
        if *when == modified {
            return Ok(hit.clone());
        }
    }

    let p = path.clone();
    let result = blocking(move || analysis::analyze(&p).map_err(|e| format!("{}: {e}", p.display()))).await?;
    // The lock is only held for the insert, never while decoding.
    cache.0.lock().unwrap_or_else(|e| e.into_inner()).insert(path, (modified, result.clone()));
    Ok(result)
}

// ---- app ----

#[tauri::command]
pub fn app_info(info: State<'_, AppInfo>) -> AppInfo {
    info.inner().clone()
}

/// Runs slow file work on Tauri's thread pool for blocking jobs.
async fn blocking<T, F>(job: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|e| format!("Background task failed: {e}"))?
}
