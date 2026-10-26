//! YouTube import through yt-dlp, plus our own conversions with ffmpeg.
//!
//! The tools live in `<dataDir>/bin` (seeded from the installer / portable zip, or
//! downloaded by Settings › Install). We only ever run those two programs with fixed
//! arguments, never a shell, and always with a `--` before the user's text so it
//! can't be read as an option.
//!
//! How a download works, and why:
//! 1. yt-dlp only downloads the best audio stream, preferring M4A. No yt-dlp
//!    post-processing, so we don't need ffprobe (smaller bundle).
//! 2. The engine's decoder (symphonia) plays AAC/M4A and MP3, but not Opus/WebM.
//!    If the stream is Opus/WebM, or MP3/WAV was asked for, we convert it ourselves
//!    with ffmpeg (same code as `media_convert`) and delete the downloaded stream.

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

/// We do all conversions ourselves with ffmpeg alone (no ffprobe needed).
fn has_ffmpeg(bin: &Path) -> bool {
    bin.join(exe("ffmpeg")).is_file()
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

/// The release zip has `<folder>/bin/ffmpeg.exe` (and more we don't need); we take only ffmpeg.exe.
fn unpack_ffmpeg(zip_path: &Path, bin: &Path) -> Result<(), String> {
    let file = std::fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("The ffmpeg download is damaged: {e}"))?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.name().rsplit('/').next() != Some("ffmpeg.exe") {
            continue;
        }
        let part = bin.join("ffmpeg.exe.part");
        let mut out = std::fs::File::create(&part).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out).map_err(|e| format!("Cannot unpack ffmpeg.exe: {e}"))?;
        drop(out);
        return std::fs::rename(&part, bin.join("ffmpeg.exe")).map_err(|e| format!("Cannot install ffmpeg.exe: {e}"));
    }
    Err("ffmpeg.exe not found in the download.".to_string())
}

// ---- convert ----

/// What our own ffmpeg conversions produce.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Target {
    /// AAC 256k: for files the engine can't decode (Opus, WebM, …).
    M4a,
    /// MP3 320k.
    Mp3,
    /// 16-bit PCM WAV.
    Wav,
}

impl Target {
    fn ext(self) -> &'static str {
        match self {
            Target::M4a => "m4a",
            Target::Mp3 => "mp3",
            Target::Wav => "wav",
        }
    }

    fn codec_args(self) -> &'static [&'static str] {
        match self {
            Target::M4a => &["-c:a", "aac", "-b:a", "256k"],
            Target::Mp3 => &["-c:a", "libmp3lame", "-b:a", "320k"],
            Target::Wav => &["-c:a", "pcm_s16le"],
        }
    }
}

/// `media_convert`: a file the engine can't decode → M4A in `dest_dir`. Blocking.
pub fn convert(bin: &Path, path: &Path, dest_dir: &Path) -> Result<String, String> {
    convert_to(bin, path, dest_dir, Target::M4a).map(|p| p.display().to_string())
}

/// Converts `path` to `target` (audio only) in `dest_dir` and returns the new path.
/// Never overwrites: "song.mp3", then "song (2).mp3", … Blocking.
fn convert_to(bin: &Path, path: &Path, dest_dir: &Path, target: Target) -> Result<PathBuf, String> {
    let ffmpeg = bin.join(exe("ffmpeg"));
    if !ffmpeg.is_file() {
        return Err("Converting this file needs ffmpeg — install it in Settings.".to_string());
    }
    std::fs::create_dir_all(dest_dir).map_err(|e| format!("Cannot create {}: {e}", dest_dir.display()))?;
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("audio");
    let ext = target.ext();
    let mut out = dest_dir.join(format!("{stem}.{ext}"));
    let mut n = 2;
    while out.exists() {
        out = dest_dir.join(format!("{stem} ({n}).{ext}"));
        n += 1;
    }
    // Write under a temporary name so a half-converted file never looks finished.
    let tmp = out.with_extension(format!("converting.{ext}"));
    let result = command(&ffmpeg)
        .args(["-hide_banner", "-nostdin", "-y", "-i"])
        .arg(path)
        .arg("-vn")
        .args(target.codec_args())
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
    Ok(out)
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
        match download_and_convert(&app, &bin, &job) {
            Ok(file) => emit(&app, &id, 100.0, "done", Some(file), None),
            Err(e) => emit(&app, &id, 0.0, "error", None, Some(e)),
        }
    }
}

/// Downloads, then converts when needed (see the top of this file). Returns the final file.
fn download_and_convert(app: &AppHandle, bin: &Path, job: &Job) -> Result<String, String> {
    let ffmpeg = has_ffmpeg(bin);
    // Fail before downloading when the conversion can't happen anyway.
    match job.format {
        Format::Mp3 if !ffmpeg => return Err("MP3 needs ffmpeg — install it in Settings.".to_string()),
        Format::Wav if !ffmpeg => return Err("WAV needs ffmpeg — install it in Settings.".to_string()),
        _ => {}
    }
    let downloaded = PathBuf::from(run_download(app, bin, job)?);
    let ext = downloaded.extension().and_then(|e| e.to_str()).unwrap_or_default().to_lowercase();
    let target = match job.format {
        Format::Mp3 => Some(Target::Mp3),
        Format::Wav => Some(Target::Wav),
        // Original: keep what the engine can play; Opus/WebM etc. become M4A.
        Format::Original if matches!(ext.as_str(), "m4a" | "mp4" | "aac" | "mp3") => None,
        Format::Original => Some(Target::M4a),
    };
    let Some(target) = target else { return Ok(downloaded.display().to_string()) };
    if !ffmpeg {
        let _ = std::fs::remove_file(&downloaded);
        return Err("This video only has Opus/WebM audio, which needs ffmpeg — install it in Settings.".to_string());
    }
    emit(app, &job.item.id, 100.0, "converting", None, None);
    let result = convert_to(bin, &downloaded, &job.dest_dir, target);
    // The downloaded stream was only a step on the way.
    let _ = std::fs::remove_file(&downloaded);
    result.map(|p| p.display().to_string())
}

/// Runs yt-dlp for one video (best audio, M4A preferred, no post-processing)
/// and returns the downloaded file's path.
fn run_download(app: &AppHandle, bin: &Path, job: &Job) -> Result<String, String> {
    let yt = yt_dlp(bin);
    if !yt.is_file() {
        return Err("yt-dlp is not installed yet (Settings › Install yt-dlp).".to_string());
    }
    let template = job.dest_dir.join("%(title)s.%(ext)s");
    let mut cmd = command(&yt);
    cmd.args(["-f", "bestaudio[ext=m4a]/bestaudio"])
        .args(["--no-playlist", "--no-warnings", "--newline", "--windows-filenames", "--encoding", "utf-8"])
        // --print makes yt-dlp quiet; --progress brings the progress lines back.
        // Our own prefixes (CPDL, CPFILE) make the lines easy to recognise.
        .args(["--progress", "--progress-template"])
        .arg("download:CPDL %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s")
        .args(["--print", "after_move:CPFILE %(filepath)s"])
        // Only for yt-dlp's own container fix-ups (no audio conversion happens there).
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
        _ => Err(error.unwrap_or_else(|| "yt-dlp stopped without a file.".to_string())),
    }
}

/// The installer ships yt-dlp and ffmpeg in its `bin` resource folder (the portable
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
    for name in ["yt-dlp.exe", "ffmpeg.exe"] {
        let (from, to) = (bundled.join(name), bin_dir.join(name));
        if from.is_file() && !to.is_file() {
            let _ = std::fs::copy(&from, &to);
        }
    }
}
