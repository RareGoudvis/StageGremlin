//! YouTube import through yt-dlp (and ffmpeg for MP3/WAV).
//!
//! Nothing is bundled: Settings › Install downloads the tools into `<dataDir>/bin`.
//! We only ever run those two programs with fixed arguments, never a shell, and
//! always with a `--` before the user's text so it can't be read as an option.
//!
//! Format choice, and why: the engine's decoder (symphonia) plays AAC/M4A but not
//! Opus/WebM. So "Original" asks YouTube for its M4A audio stream (no re-encode,
//! no ffmpeg needed). Only when a video has no M4A stream do we convert, which
//! needs ffmpeg. MP3 and WAV always go through ffmpeg.

use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};

const YT_DLP_URL: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
const FFMPEG_URL: &str = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";
/// Downloads running at the same time.
const WORKERS: usize = 2;
/// Lines resolved at the same time (each one starts a yt-dlp process).
const RESOLVE_PARALLEL: usize = 4;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Tool {
    YtDlp,
    Ffmpeg,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Format {
    Original,
    Mp3,
    Wav,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YtStatus {
    /// yt-dlp version, or `None` when it is not installed.
    pub yt_dlp: Option<String>,
    pub ffmpeg: bool,
    pub bin_dir: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YtItem {
    pub id: String,
    pub input: String,
    pub url: String,
    pub title: String,
    pub channel: String,
    pub duration: f64,
    pub playlist: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadItem {
    pub id: String,
    pub url: String,
    /// Sent by the UI for its own list; the file name comes from yt-dlp.
    #[allow(dead_code)]
    pub title: String,
}

/// Payload of `yt://install`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallProgress {
    what: Tool,
    percent: f64,
    done: bool,
    error: Option<String>,
}

/// Payload of `yt://progress`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    id: String,
    percent: f64,
    status: &'static str,
    file: Option<String>,
    error: Option<String>,
}

struct Job {
    item: DownloadItem,
    format: Format,
    dest_dir: PathBuf,
}

/// Managed state: where the tools live, and the download queue.
pub struct Yt {
    bin_dir: PathBuf,
    queue: Sender<Job>,
}

impl Yt {
    /// Starts the two download workers. They wait for jobs until the app exits.
    pub fn new(app: AppHandle, data_dir: &Path) -> Self {
        let bin_dir = data_dir.join("bin");
        seed_bundled_tools(&app, &bin_dir);
        let (queue, rx) = mpsc::channel::<Job>();
        let rx = Arc::new(Mutex::new(rx));
        for n in 0..WORKERS {
            let (app, rx, bin) = (app.clone(), rx.clone(), bin_dir.clone());
            std::thread::Builder::new()
                .name(format!("cueplay-yt-{n}"))
                .spawn(move || worker(app, rx, bin))
                .expect("could not start a download thread");
        }
        Self { bin_dir, queue }
    }

    pub fn bin_dir(&self) -> &Path {
        &self.bin_dir
    }

    /// Puts downloads in the queue; progress arrives as `yt://progress` events.
    pub fn enqueue(&self, app: &AppHandle, items: Vec<DownloadItem>, format: Format, dest_dir: PathBuf) -> Result<(), String> {
        std::fs::create_dir_all(&dest_dir).map_err(|e| format!("Cannot create {}: {e}", dest_dir.display()))?;
        for item in items {
            emit(app, &item.id, 0.0, "queued", None, None);
            self.queue
                .send(Job { item, format, dest_dir: dest_dir.clone() })
                .map_err(|_| "The download queue has stopped.".to_string())?;
        }
        Ok(())
    }
}

/// Is yt-dlp there (and which version), is ffmpeg there. Starts a process: blocking.
pub fn status(bin: &Path) -> YtStatus {
    let version = command(&yt_dlp(bin))
        .arg("--version")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());
    YtStatus { yt_dlp: version, ffmpeg: has_ffmpeg(bin), bin_dir: bin.display().to_string() }
}

fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

fn yt_dlp(bin: &Path) -> PathBuf {
    bin.join(exe("yt-dlp"))
}

/// yt-dlp needs both ffmpeg and ffprobe to convert audio.
fn has_ffmpeg(bin: &Path) -> bool {
    bin.join(exe("ffmpeg")).is_file() && bin.join(exe("ffprobe")).is_file()
}

/// A command for one of our tools: UTF-8 output, and on Windows no console
/// window flashing up for every call.
fn command(program: &Path) -> Command {
    let mut c = Command::new(program);
    c.stdin(Stdio::null()).env("PYTHONUTF8", "1").env("PYTHONIOENCODING", "utf-8");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}

// ---- install ----

/// Downloads (and for ffmpeg unpacks) a tool into the bin folder. Blocking.
pub fn install(app: &AppHandle, bin: &Path, what: Tool) -> Result<(), String> {
    let result = install_inner(app, bin, what);
    let error = result.as_ref().err().cloned();
    let percent = if error.is_none() { 100.0 } else { 0.0 };
    let _ = app.emit("yt://install", InstallProgress { what, percent, done: true, error });
    result
}

fn install_inner(app: &AppHandle, bin: &Path, what: Tool) -> Result<(), String> {
    std::fs::create_dir_all(bin).map_err(|e| format!("Cannot create {}: {e}", bin.display()))?;
    let progress = |percent: f64| {
        let _ = app.emit("yt://install", InstallProgress { what, percent, done: false, error: None });
    };
    match what {
        Tool::YtDlp => {
            let part = bin.join("yt-dlp.exe.part");
            download(YT_DLP_URL, &part, progress)?;
            // Rename over the old one only when the download is complete.
            std::fs::rename(&part, yt_dlp(bin)).map_err(|e| format!("Cannot install yt-dlp: {e}"))
        }
        Tool::Ffmpeg => {
            let zip_path = bin.join("ffmpeg.zip.part");
            download(FFMPEG_URL, &zip_path, progress)?;
            let result = unpack_ffmpeg(&zip_path, bin);
            let _ = std::fs::remove_file(&zip_path);
            result
        }
    }
}

/// Streams `url` to `dest`, reporting 0–100 % (whole percents only, to keep the event rate low).
fn download(url: &str, dest: &Path, progress: impl Fn(f64)) -> Result<(), String> {
    let response = ureq::get(url).call().map_err(|e| format!("Download failed ({url}): {e}"))?;
    let total = response.body().content_length();
    let mut reader = response.into_body().into_reader();
    let mut file = std::fs::File::create(dest).map_err(|e| format!("Cannot write {}: {e}", dest.display()))?;
    let mut buf = vec![0u8; 64 * 1024];
    let (mut done, mut last_pct) = (0u64, -1.0);
    loop {
        let n = reader.read(&mut buf).map_err(|e| format!("Download interrupted: {e}"))?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).map_err(|e| format!("Cannot write {}: {e}", dest.display()))?;
        done += n as u64;
        if let Some(total) = total.filter(|t| *t > 0) {
            let pct = (done as f64 * 100.0 / total as f64).floor();
            if pct > last_pct {
                last_pct = pct;
                progress(pct);
            }
        }
    }
    file.flush().map_err(|e| e.to_string())
}

/// The release zip has `<folder>/bin/ffmpeg.exe` and `ffprobe.exe`; we take just those two.
fn unpack_ffmpeg(zip_path: &Path, bin: &Path) -> Result<(), String> {
    let file = std::fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("The ffmpeg download is damaged: {e}"))?;
    let mut found = 0;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().rsplit('/').next().unwrap_or_default().to_string();
        if name != "ffmpeg.exe" && name != "ffprobe.exe" {
            continue;
        }
        let part = bin.join(format!("{name}.part"));
        let mut out = std::fs::File::create(&part).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out).map_err(|e| format!("Cannot unpack {name}: {e}"))?;
        drop(out);
        std::fs::rename(&part, bin.join(&name)).map_err(|e| format!("Cannot install {name}: {e}"))?;
        found += 1;
    }
    if found < 2 {
        return Err("ffmpeg.exe / ffprobe.exe not found in the download.".to_string());
    }
    Ok(())
}

// ---- convert ----

/// Converts a file the engine cannot decode (Opus, WebM, …) to M4A (AAC 256k,
/// audio only) in `dest_dir`, and returns the new path. Blocking.
pub fn convert(bin: &Path, path: &Path, dest_dir: &Path) -> Result<String, String> {
    let ffmpeg = bin.join(exe("ffmpeg"));
    if !ffmpeg.is_file() {
        return Err("Converting this file needs ffmpeg — install it in Settings.".to_string());
    }
    std::fs::create_dir_all(dest_dir).map_err(|e| format!("Cannot create {}: {e}", dest_dir.display()))?;
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("audio");
    // Never overwrite: "song.m4a", then "song (2).m4a", …
    let mut out = dest_dir.join(format!("{stem}.m4a"));
    let mut n = 2;
    while out.exists() {
        out = dest_dir.join(format!("{stem} ({n}).m4a"));
        n += 1;
    }
    // Write under a temporary name so a half-converted file never looks finished.
    let tmp = out.with_extension("converting.m4a");
    let result = command(&ffmpeg)
        .args(["-hide_banner", "-nostdin", "-y", "-i"])
        .arg(path)
        .args(["-vn", "-c:a", "aac", "-b:a", "256k"])
        .arg(&tmp)
        .output()
        .map_err(|e| format!("Could not run ffmpeg: {e}"))?;
    if !result.status.success() {
        let _ = std::fs::remove_file(&tmp);
        let stderr = String::from_utf8_lossy(&result.stderr);
        let last = stderr.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("unknown error");
        return Err(format!("ffmpeg could not convert {}: {last}", path.display()));
    }
    std::fs::rename(&tmp, &out).map_err(|e| e.to_string())?;
    Ok(out.display().to_string())
}

// ---- resolve ----

/// Turns pasted lines into videos. Blocking; several lines are looked up at once.
pub fn resolve(bin: &Path, lines: Vec<String>) -> Result<Vec<YtItem>, String> {
    let yt = yt_dlp(bin);
    if !yt.is_file() {
        return Err("yt-dlp is not installed yet (Settings › Install yt-dlp).".to_string());
    }
    let lines: Vec<String> = lines.into_iter().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect();
    let mut items = vec![];
    for chunk in lines.chunks(RESOLVE_PARALLEL) {
        let results: Vec<Vec<YtItem>> = std::thread::scope(|s| {
            let handles: Vec<_> = chunk.iter().map(|line| s.spawn(|| resolve_line(&yt, line))).collect();
            handles.into_iter().map(|h| h.join().unwrap_or_default()).collect()
        });
        items.extend(results.into_iter().flatten());
    }
    // The same video pasted twice still needs two distinct ids for the UI.
    let mut seen = std::collections::HashMap::<String, u32>::new();
    for item in &mut items {
        let n = seen.entry(item.id.clone()).or_insert(0);
        *n += 1;
        if *n > 1 {
            item.id = format!("{}#{}", item.id, n);
        }
    }
    Ok(items)
}

fn looks_like_url(line: &str) -> bool {
    line.starts_with("http://") || line.starts_with("https://") || line.contains("youtube.com/") || line.contains("youtu.be/")
}

/// One line: a video link, a playlist link (all its videos) or search text (top hit).
fn resolve_line(yt: &Path, line: &str) -> Vec<YtItem> {
    let is_url = looks_like_url(line);
    let target = if is_url { line.to_string() } else { format!("ytsearch1:{line}") };
    let output = command(yt).args(["--dump-json", "--flat-playlist", "--no-warnings", "--encoding", "utf-8", "--"]).arg(&target).output();
    let output = match output {
        Ok(o) => o,
        Err(e) => return vec![error_item(line, format!("Could not run yt-dlp: {e}"))],
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    let items: Vec<YtItem> = stdout
        .lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .map(|v| to_item(line, is_url, &v))
        .collect();
    if !items.is_empty() {
        return items;
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let msg = stderr
        .lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .map(|l| l.trim_start_matches("ERROR:").trim().to_string())
        .unwrap_or_else(|| "Nothing found.".to_string());
    vec![error_item(line, msg)]
}

fn to_item(input: &str, is_url: bool, v: &Value) -> YtItem {
    let s = |key: &str| v.get(key).and_then(Value::as_str).map(str::to_string);
    let id = s("id").unwrap_or_default();
    // A full video record's "url" is the raw media stream; we want the watch page.
    let url = s("webpage_url")
        .or_else(|| s("url").filter(|u| u.contains("youtube.com/watch") || u.contains("youtu.be/")))
        .unwrap_or_else(|| format!("https://www.youtube.com/watch?v={id}"));
    YtItem {
        id,
        input: input.to_string(),
        url,
        title: s("title").unwrap_or_default(),
        channel: s("channel").or_else(|| s("uploader")).unwrap_or_default(),
        duration: v.get("duration").and_then(Value::as_f64).unwrap_or(0.0),
        playlist: if is_url { s("playlist_title").or_else(|| s("playlist")) } else { None },
        error: None,
    }
}

fn error_item(input: &str, error: String) -> YtItem {
    YtItem {
        id: format!("error:{input}"),
        input: input.to_string(),
        url: String::new(),
        title: String::new(),
        channel: String::new(),
        duration: 0.0,
        playlist: None,
        error: Some(error),
    }
}

// ---- download ----

fn emit(app: &AppHandle, id: &str, percent: f64, status: &'static str, file: Option<String>, error: Option<String>) {
    let _ = app.emit("yt://progress", Progress { id: id.to_string(), percent, status, file, error });
}

fn worker(app: AppHandle, rx: Arc<Mutex<Receiver<Job>>>, bin: PathBuf) {
    loop {
        // The lock is only held while waiting for the next job.
        let job = rx.lock().unwrap_or_else(|e| e.into_inner()).recv();
        let Ok(job) = job else { return };
        let id = job.item.id.clone();
        match run_download(&app, &bin, &job) {
            Ok(file) => emit(&app, &id, 100.0, "done", Some(file), None),
            Err(e) => emit(&app, &id, 0.0, "error", None, Some(e)),
        }
    }
}

/// The yt-dlp arguments for each output format (see the top of this file for why).
fn format_args(format: Format, ffmpeg: bool) -> Result<Vec<&'static str>, String> {
    let need = |what: &str| format!("{what} needs ffmpeg — install it in Settings.");
    Ok(match format {
        // M4A stream: kept as is. Opus/WebM only: converted to AAC 256k (same as media_convert).
        Format::Original if ffmpeg => {
            vec!["-f", "bestaudio[ext=m4a]/bestaudio", "-x", "--audio-format", "m4a", "--audio-quality", "256K"]
        }
        Format::Original => vec!["-f", "bestaudio[ext=m4a]"],
        Format::Mp3 if ffmpeg => vec!["-f", "bestaudio/best", "-x", "--audio-format", "mp3", "--audio-quality", "0"],
        Format::Wav if ffmpeg => vec!["-f", "bestaudio/best", "-x", "--audio-format", "wav"],
        Format::Mp3 => return Err(need("MP3")),
        Format::Wav => return Err(need("WAV")),
    })
}

/// Runs one download and returns the final file path.
fn run_download(app: &AppHandle, bin: &Path, job: &Job) -> Result<String, String> {
    let yt = yt_dlp(bin);
    if !yt.is_file() {
        return Err("yt-dlp is not installed yet (Settings › Install yt-dlp).".to_string());
    }
    let ffmpeg = has_ffmpeg(bin);
    let template = job.dest_dir.join("%(title)s.%(ext)s");
    let mut cmd = command(&yt);
    cmd.args(format_args(job.format, ffmpeg)?)
        .args(["--no-playlist", "--no-warnings", "--newline", "--windows-filenames", "--encoding", "utf-8"])
        // --print makes yt-dlp quiet; --progress brings the progress lines back.
        // Our own prefixes (CPDL, CPPP, CPFILE) make the lines easy to recognise.
        .args(["--progress", "--progress-template"])
        .arg("download:CPDL %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s")
        .args(["--progress-template", "postprocess:CPPP %(progress.status)s"])
        .args(["--print", "after_move:CPFILE %(filepath)s"])
        .arg("--ffmpeg-location")
        .arg(bin)
        .arg("-o")
        .arg(&template)
        .arg("--")
        .arg(&job.item.url)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("Could not run yt-dlp: {e}"))?;

    // Read stdout and stderr on two small threads and merge their lines.
    let (tx, lines) = mpsc::channel::<String>();
    let readers: Vec<_> = [
        child.stdout.take().map(|s| Box::new(s) as Box<dyn Read + Send>),
        child.stderr.take().map(|s| Box::new(s) as Box<dyn Read + Send>),
    ]
    .into_iter()
    .flatten()
    .map(|pipe| {
        let tx = tx.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                let _ = tx.send(line);
            }
        })
    })
    .collect();
    drop(tx); // the loop below ends when both readers are done

    let id = &job.item.id;
    let (mut file, mut error, mut last_pct) = (None, None, -1.0);
    for line in lines {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("CPDL ") {
            let nums: Vec<Option<f64>> = rest.split_whitespace().map(|n| n.parse::<f64>().ok()).collect();
            let done = nums.first().copied().flatten();
            let total = nums.get(1).copied().flatten().or(nums.get(2).copied().flatten());
            if let (Some(d), Some(t)) = (done, total.filter(|t| *t > 0.0)) {
                let pct = (d * 100.0 / t).clamp(0.0, 100.0).floor();
                if pct > last_pct {
                    last_pct = pct;
                    emit(app, id, pct, "downloading", None, None);
                }
            }
        } else if line.starts_with("CPPP started") {
            emit(app, id, 100.0, "converting", None, None);
        } else if let Some(path) = line.strip_prefix("CPFILE ") {
            file = Some(path.to_string());
        } else if let Some(msg) = line.strip_prefix("ERROR:") {
            error = Some(msg.trim().to_string());
        }
    }
    for r in readers {
        let _ = r.join();
    }
    let status = child.wait().map_err(|e| e.to_string())?;

    match (status.success(), file) {
        (true, Some(f)) => Ok(f),
        _ => {
            let mut msg = error.unwrap_or_else(|| "yt-dlp stopped without a file.".to_string());
            if job.format == Format::Original && !ffmpeg && msg.contains("Requested format is not available") {
                msg = "This video only has Opus/WebM audio, which needs ffmpeg — install it in Settings.".to_string();
            }
            Err(msg)
        }
    }
}

/// The installer ships yt-dlp, ffmpeg and ffprobe in its `bin` resource folder (the portable
/// zip puts them straight into `data/bin`). On start, copy any that are missing into the
/// data folder, so they work offline from the first run. Later updates (Settings › Update)
/// overwrite the copies in the data folder, never the bundled originals.
fn seed_bundled_tools(app: &AppHandle, bin_dir: &Path) {
    use tauri::Manager;
    let Ok(res) = app.path().resource_dir() else { return };
    let bundled = res.join("bin");
    if !bundled.is_dir() {
        return;
    }
    let _ = std::fs::create_dir_all(bin_dir);
    for name in ["yt-dlp.exe", "ffmpeg.exe", "ffprobe.exe"] {
        let (from, to) = (bundled.join(name), bin_dir.join(name));
        if from.is_file() && !to.is_file() {
            let _ = std::fs::copy(&from, &to);
        }
    }
}
