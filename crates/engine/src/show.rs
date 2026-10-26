//! The show document: what a `.cueplay` file contains.
//!
//! A show is a list of sections, each holding an ordered list of cues. File paths
//! are stored relative to the show file's folder (normally `media/…`), so the whole
//! folder can be copied to a USB stick or another laptop.
//!
//! Every field has a serde default, so older show files keep opening after new
//! fields are added. Field names are camelCase in JSON to match the TypeScript side.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const FORMAT_VERSION: u32 = 1;

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Show {
    pub version: u32,
    pub name: String,
    pub settings: ShowSettings,
    pub sections: Vec<Section>,
    /// Soundboard pads, played from the Run dock with keys 1–9, 0.
    pub pads: Vec<Pad>,
    /// Background player settings for this show (duck level, times, offsets, source).
    /// Kept as free JSON so the background module owns its own shape.
    pub background: Option<serde_json::Value>,
}

impl Default for Show {
    fn default() -> Self {
        Self {
            version: FORMAT_VERSION,
            name: "New show".into(),
            settings: ShowSettings::default(),
            sections: vec![Section::new("Opening")],
            pads: vec![],
            background: None,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum PadMode {
    /// Plays once; pressing again restarts it.
    #[default]
    OneShot,
    /// First press plays, second press stops (with the pad's stop fade).
    Toggle,
    /// Loops until pressed again.
    Loop,
}

/// A soundboard pad. The sound settings (file, gain, fades, EQ…) live in `cue`, so
/// pads and cues share one audio chain and one editor.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Pad {
    pub id: String,
    /// "1"…"9", "0", or empty for no key.
    pub hotkey: String,
    pub mode: PadMode,
    pub cue: Cue,
}

impl Default for Pad {
    fn default() -> Self {
        Self { id: new_id(), hotkey: String::new(), mode: PadMode::OneShot, cue: Cue { duck_bg: false, ..Default::default() } }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ShowSettings {
    /// Loudness every cue is normalised to (EBU R128 integrated). Brief: −14 LUFS.
    pub target_lufs: f64,
    /// Normalisation never pushes a cue's true peak above this (dBTP).
    pub peak_ceiling_db: f64,
    /// Master limiter ceiling (dBTP).
    pub limiter_ceiling_db: f64,
    /// Fade time used by Stop all, in seconds.
    pub stop_all_fade: f64,
    /// A second GO within this many milliseconds is ignored.
    pub double_go_ms: u64,
    /// Default level a cue drops to on Under (U), in dB relative to its normal level.
    pub under_db: f64,
    /// Fade time for Under and back up, in seconds.
    pub under_fade: f64,
}

impl Default for ShowSettings {
    fn default() -> Self {
        Self {
            target_lufs: -14.0,
            peak_ceiling_db: -1.0,
            limiter_ceiling_db: -1.0,
            stop_all_fade: 2.0,
            double_go_ms: 300,
            under_db: -12.0,
            under_fade: 1.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Section {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub cues: Vec<Cue>,
}

impl Default for Section {
    fn default() -> Self {
        Self::new("Section")
    }
}

impl Section {
    pub fn new(name: &str) -> Self {
        Self { id: new_id(), name: name.into(), color: None, cues: vec![] }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum Curve {
    Linear,
    #[default]
    SCurve,
    Exponential,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Notes {
    pub sound: String,
    pub lx: String,
    pub stage: String,
}

/// What happens after this cue starts or ends.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Follow {
    /// Wait for the operator's GO.
    #[default]
    None,
    /// Start the next cue when this one ends (after all its passes).
    AfterEnd,
    /// Start the next cue this many seconds after this one starts; this one keeps playing.
    AfterStart { delay: f64 },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct EqBand {
    pub freq: f64,
    pub gain_db: f64,
    pub q: f64,
    pub on: bool,
}

impl Default for EqBand {
    fn default() -> Self {
        Self { freq: 1000.0, gain_db: 0.0, q: 0.7, on: true }
    }
}

/// Four bands: low shelf, two peaks, high shelf.
pub fn default_eq() -> [EqBand; 4] {
    [
        EqBand { freq: 100.0, ..Default::default() },
        EqBand { freq: 500.0, q: 1.0, ..Default::default() },
        EqBand { freq: 2500.0, q: 1.0, ..Default::default() },
        EqBand { freq: 8000.0, ..Default::default() },
    ]
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Compressor {
    pub on: bool,
    pub threshold_db: f64,
    pub ratio: f64,
    pub attack_ms: f64,
    pub release_ms: f64,
    pub makeup_db: f64,
}

impl Default for Compressor {
    fn default() -> Self {
        Self { on: false, threshold_db: -18.0, ratio: 2.0, attack_ms: 10.0, release_ms: 150.0, makeup_db: 0.0 }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Loudness {
    /// Integrated loudness, LUFS.
    pub lufs: f64,
    /// True peak, dBTP.
    pub true_peak_db: f64,
    /// Loudness range, LU.
    pub lra: f64,
    /// File duration in seconds.
    pub duration: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Vamp {
    pub a: f64,
    pub b: f64,
    pub on: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Marker {
    pub t: f64,
    pub label: String,
}

/// A cue hung on a moment inside another cue: fires by itself, skips the GO queue,
/// stops with its parent.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Attach {
    pub to: String,
    /// Seconds into the parent's file.
    pub at: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Cue {
    pub id: String,
    pub number: String,
    pub name: String,
    /// Relative to the show folder once saved; absolute for not-yet-saved imports.
    pub file: String,
    pub color: Option<String>,
    pub notes: Notes,

    pub trim_in: f64,
    /// None = play to the end of the file.
    pub trim_out: Option<f64>,
    pub gain_db: f64,
    pub pan: f64,
    /// High-pass cutoff in Hz; None = off.
    pub hpf: Option<f64>,
    pub eq: [EqBand; 4],
    pub comp: Compressor,

    pub fade_in: f64,
    pub fade_out: f64,
    pub stop_fade: f64,
    pub curve: Curve,

    pub pre_wait: f64,
    /// 1–5 passes; 0 = loop until stopped.
    pub play_count: u32,
    pub follow: Follow,
    /// GO on this cue ducks the background player.
    pub duck_bg: bool,
    /// Level for Under (U), dB relative to normal. None = show default.
    pub under_db: Option<f64>,
    /// GO on this cue fades out everything else over this many seconds. None = off.
    pub fade_go: Option<f64>,
    pub vamp: Option<Vamp>,
    pub markers: Vec<Marker>,
    pub attach: Option<Attach>,

    /// Filled in by loudness analysis on import.
    pub loudness: Option<Loudness>,
    /// Set by an emergency swap; holds the original file so it can be undone.
    pub swapped_from: Option<String>,
}

impl Default for Cue {
    fn default() -> Self {
        Self {
            id: new_id(),
            number: String::new(),
            name: String::new(),
            file: String::new(),
            color: None,
            notes: Notes::default(),
            trim_in: 0.0,
            trim_out: None,
            gain_db: 0.0,
            pan: 0.0,
            hpf: None,
            eq: default_eq(),
            comp: Compressor::default(),
            fade_in: 0.0,
            fade_out: 0.0,
            stop_fade: 1.0,
            curve: Curve::SCurve,
            pre_wait: 0.0,
            play_count: 1,
            follow: Follow::None,
            duck_bg: true,
            under_db: None,
            fade_go: None,
            vamp: None,
            markers: vec![],
            attach: None,
            loudness: None,
            swapped_from: None,
        }
    }
}

/// Result of applying the normalisation rules to one cue.
#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NormGain {
    pub gain_db: f64,
    /// True when the peak cap held the gain below what the loudness target asked for.
    pub peak_limited: bool,
}

/// gain = target − measured, capped so the boosted true peak stays under the ceiling.
pub fn norm_gain(l: &Loudness, s: &ShowSettings) -> NormGain {
    if !l.lufs.is_finite() {
        // Silent file: leave it alone.
        return NormGain { gain_db: 0.0, peak_limited: false };
    }
    let wanted = s.target_lufs - l.lufs;
    let cap = s.peak_ceiling_db - l.true_peak_db;
    if wanted > cap {
        NormGain { gain_db: cap, peak_limited: true }
    } else {
        NormGain { gain_db: wanted, peak_limited: false }
    }
}

impl Cue {
    pub fn from_file(path: &Path) -> Self {
        let name = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "Cue".into());
        Self { name, file: path.to_string_lossy().to_string(), ..Default::default() }
    }

    pub fn norm(&self, s: &ShowSettings) -> NormGain {
        self.loudness.as_ref().map(|l| norm_gain(l, s)).unwrap_or(NormGain { gain_db: 0.0, peak_limited: false })
    }

    /// Total level offset applied to the sound: normalisation plus manual gain.
    pub fn level_db(&self, s: &ShowSettings) -> f64 {
        self.norm(s).gain_db + self.gain_db
    }

    /// Length after trim, in seconds (one pass). None if the file length is unknown.
    pub fn trimmed_len(&self) -> Option<f64> {
        let dur = self.loudness.map(|l| l.duration)?;
        let out = self.trim_out.unwrap_or(dur).min(dur);
        Some((out - self.trim_in).max(0.0))
    }
}

impl Show {
    pub fn cues(&self) -> impl Iterator<Item = &Cue> {
        self.sections.iter().flat_map(|s| s.cues.iter())
    }

    pub fn cue(&self, id: &str) -> Option<&Cue> {
        self.cues().find(|c| c.id == id)
    }

    pub fn cue_mut(&mut self, id: &str) -> Option<&mut Cue> {
        self.sections.iter_mut().flat_map(|s| s.cues.iter_mut()).find(|c| c.id == id)
    }

    /// Cues the GO button steps through, in order: everything except attached cues.
    pub fn go_queue(&self) -> Vec<&Cue> {
        self.cues().filter(|c| c.attach.is_none()).collect()
    }

    /// The GO-queue cue after `id`, if any.
    pub fn next_in_queue(&self, id: &str) -> Option<&Cue> {
        let q = self.go_queue();
        let i = q.iter().position(|c| c.id == id)?;
        q.get(i + 1).copied()
    }

    pub fn first_in_queue(&self) -> Option<&Cue> {
        self.go_queue().first().copied()
    }

    /// Cues attached to `parent_id`.
    pub fn children_of<'a>(&'a self, parent_id: &'a str) -> impl Iterator<Item = &'a Cue> + 'a {
        self.cues().filter(move |c| c.attach.as_ref().is_some_and(|a| a.to == parent_id))
    }

    /// Numbers every cue 1, 2, 3… in order; attached cues get parent.1, parent.2…
    pub fn renumber(&mut self) {
        let mut n = 0;
        let mut numbers: Vec<(String, String)> = vec![];
        for c in self.cues() {
            if c.attach.is_none() {
                n += 1;
                numbers.push((c.id.clone(), n.to_string()));
            }
        }
        let mut child_count: std::collections::HashMap<String, u32> = Default::default();
        let parent_num: std::collections::HashMap<String, String> = numbers.iter().cloned().collect();
        for c in self.cues() {
            if let Some(a) = &c.attach {
                let k = child_count.entry(a.to.clone()).or_insert(0);
                *k += 1;
                let p = parent_num.get(&a.to).cloned().unwrap_or_else(|| "?".into());
                numbers.push((c.id.clone(), format!("{p}.{k}")));
            }
        }
        for (id, num) in numbers {
            if let Some(c) = self.cue_mut(&id) {
                c.number = num;
            }
        }
    }

    /// Moves cue `id` so it sits directly before `before_id` (Make next).
    pub fn move_before(&mut self, id: &str, before_id: &str) -> bool {
        if id == before_id {
            return false;
        }
        let Some(cue) = self.take_cue(id) else { return false };
        for s in &mut self.sections {
            if let Some(i) = s.cues.iter().position(|c| c.id == before_id) {
                s.cues.insert(i, cue);
                return true;
            }
        }
        // Target vanished: put it back at the end so nothing is lost.
        if let Some(s) = self.sections.last_mut() {
            s.cues.push(cue);
        }
        false
    }

    fn take_cue(&mut self, id: &str) -> Option<Cue> {
        for s in &mut self.sections {
            if let Some(i) = s.cues.iter().position(|c| c.id == id) {
                return Some(s.cues.remove(i));
            }
        }
        None
    }

    /// Resolves a cue's file against the show folder.
    pub fn resolve(&self, base_dir: Option<&Path>, file: &str) -> PathBuf {
        let p = PathBuf::from(file);
        if p.is_absolute() {
            return p;
        }
        match base_dir {
            Some(b) => b.join(p),
            None => p,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ShowFileError {
    #[error("could not read or write the show file: {0}")]
    Io(#[from] std::io::Error),
    #[error("the show file is damaged or not a .cueplay file: {0}")]
    Json(#[from] serde_json::Error),
}

pub fn load(path: &Path) -> Result<Show, ShowFileError> {
    let text = std::fs::read_to_string(path)?;
    Ok(serde_json::from_str(&text)?)
}

/// Saves the show next to its media. Files that live outside `<show folder>/media`
/// are copied in and their paths rewritten, so the folder is always complete.
/// Writes to a temp file first, then renames, so a crash mid-save never leaves a
/// half-written show. The previous version is kept in `backups/` (last 20).
pub fn save(path: &Path, show: &mut Show) -> Result<(), ShowFileError> {
    let dir = path.parent().map(Path::to_path_buf).unwrap_or_default();
    let media = dir.join("media");
    std::fs::create_dir_all(&media)?;
    for p in &mut show.pads {
        p.cue.file = collect_media(&dir, &media, &p.cue.file)?;
    }
    for s in &mut show.sections {
        for c in &mut s.cues {
            c.file = collect_media(&dir, &media, &c.file)?;
            if let Some(orig) = &c.swapped_from {
                c.swapped_from = Some(collect_media(&dir, &media, orig)?);
            }
        }
    }
    if path.exists() {
        backup(&dir, path)?;
    }
    let tmp = path.with_extension("cueplay.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(show)?)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

fn collect_media(dir: &Path, media: &Path, file: &str) -> Result<String, std::io::Error> {
    if file.is_empty() {
        return Ok(String::new());
    }
    let p = PathBuf::from(file);
    let abs = if p.is_absolute() { p } else { dir.join(&p) };
    if abs.starts_with(media) {
        return Ok(rel(dir, &abs));
    }
    if !abs.exists() {
        // Missing file: keep the reference so Locate… can fix it later.
        return Ok(file.to_string());
    }
    let name = abs.file_name().map(|n| n.to_owned()).unwrap_or_default();
    let mut target = media.join(&name);
    let mut i = 1;
    while target.exists() && !same_file(&abs, &target) {
        let stem = Path::new(&name).file_stem().unwrap_or_default().to_string_lossy();
        let ext = Path::new(&name).extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
        target = media.join(format!("{stem} ({i}){ext}"));
        i += 1;
    }
    if !target.exists() {
        std::fs::copy(&abs, &target)?;
    }
    Ok(rel(dir, &target))
}

fn same_file(a: &Path, b: &Path) -> bool {
    match (std::fs::metadata(a), std::fs::metadata(b)) {
        (Ok(x), Ok(y)) => x.len() == y.len(),
        _ => false,
    }
}

fn rel(dir: &Path, abs: &Path) -> String {
    abs.strip_prefix(dir).unwrap_or(abs).to_string_lossy().replace('\\', "/")
}

fn backup(dir: &Path, path: &Path) -> Result<(), std::io::Error> {
    let backups = dir.join("backups");
    std::fs::create_dir_all(&backups)?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let stem = path.file_stem().unwrap_or_default().to_string_lossy();
    std::fs::copy(path, backups.join(format!("{stem}-{stamp}.cueplay")))?;
    let mut all: Vec<_> = std::fs::read_dir(&backups)?.filter_map(|e| e.ok()).map(|e| e.path()).collect();
    all.sort();
    while all.len() > 20 {
        let _ = std::fs::remove_file(all.remove(0));
    }
    Ok(())
}
