//! Playback: the playhead, GO, running cues, timers and the master bus.
//!
//! The engine owns kira's `AudioManager`. Kira mixes on its own audio thread; this
//! struct only sends it commands, so nothing here can make the audio glitch.
//! The host calls `tick()` every ~10–20 ms to advance timers (pre-waits, follow
//! triggers, attached cues, fade-outs before the out-point) and to read state.
//!
//! The show document is owned by the UI; the engine gets a copy through
//! `set_show` whenever it changes. A cue that is already running keeps the
//! settings it was started with.

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use kira::backend::Backend;
use kira::effect::compressor::CompressorBuilder;
use kira::effect::eq_filter::{EqFilterBuilder, EqFilterKind};
use kira::effect::filter::{FilterBuilder, FilterMode};
use kira::sound::streaming::{StreamingSoundData, StreamingSoundHandle};
use kira::sound::{FromFileError, PlaybackState};
use kira::track::{MainTrackBuilder, TrackBuilder, TrackHandle};
use kira::{AudioManager, AudioManagerSettings, Decibels, Easing, Panning, StartTime, Tween};
use serde::Serialize;

use crate::dsp::{LimiterBuilder, MeterReading, MeterShared};
use crate::show::{Curve, Cue, Follow, PadMode, Show};
use crate::tone::{self, ToneKind};
use kira::sound::static_sound::StaticSoundHandle;

/// Panic stops everything this fast: no fade, but no click either.
const PANIC_FADE: f64 = 0.005;

fn tween(secs: f64, curve: Curve) -> Tween {
    Tween {
        start_time: StartTime::Immediate,
        duration: Duration::from_secs_f64(secs.max(0.0)),
        easing: match curve {
            Curve::Linear => Easing::Linear,
            Curve::SCurve => Easing::InOutPowi(2),
            Curve::Exponential => Easing::InPowi(2),
        },
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PendingKind {
    /// Waiting out a cue's pre-wait.
    PreWait,
    /// A follow trigger ("start next cue N s after this one starts").
    Follow,
    /// An attached cue waiting for its moment inside the parent.
    Attached,
}

#[derive(Debug, Clone)]
struct Pending {
    at: f64,
    cue_id: String,
    kind: PendingKind,
    /// Attached cues belong to a running instance and die with it.
    parent: Option<u64>,
}

struct Running {
    instance: u64,
    cue: Cue,
    sound: StreamingSoundHandle<FromFileError>,
    track: TrackHandle,
    parent: Option<u64>,
    /// Set when this sound is a soundboard pad.
    pad: Option<String>,
    /// Length of one pass after trim, seconds.
    len: f64,
    pass: u32,
    last_pos: f64,
    fading_out: bool,
    stopping: bool,
    under: bool,
    vamping: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningInfo {
    pub instance: u64,
    pub cue_id: String,
    pub number: String,
    pub name: String,
    /// Seconds into the current pass (after trim).
    pub position: f64,
    /// Length of one pass, seconds.
    pub length: f64,
    pub remaining: f64,
    pub pass: u32,
    /// 0 = loops until stopped.
    pub play_count: u32,
    pub under: bool,
    pub vamping: bool,
    pub stopping: bool,
    pub attached: bool,
    /// Pad id when this is a soundboard pad (pads never move the playhead).
    pub pad_id: Option<String>,
    /// This cue ducks the background player while it plays.
    pub duck_bg: bool,
    /// Next song marker ahead of the play position: (label, seconds until it).
    pub next_marker: Option<(String, f64)>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingInfo {
    pub cue_id: String,
    pub kind: PendingKind,
    pub in_secs: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    /// Seconds since the engine started.
    pub clock: f64,
    /// Unix time in milliseconds, for the printed log.
    pub wall_ms: u64,
    pub kind: String,
    pub cue_id: Option<String>,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineState {
    pub clock: f64,
    pub paused: bool,
    pub master_db: f64,
    pub playhead: Option<String>,
    pub running: Vec<RunningInfo>,
    pub pending: Vec<PendingInfo>,
    pub meter: MeterReading,
    /// Log entries added since the previous `state()` call.
    pub new_log: Vec<LogEntry>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GoResult {
    Fired,
    /// Double-press protection swallowed it.
    Ignored,
    /// Nothing standing by.
    EndOfShow,
}

pub struct Engine<B: Backend> {
    manager: AudioManager<B>,
    meter: Arc<MeterShared>,
    show: Show,
    base_dir: Option<PathBuf>,
    playhead: Option<String>,
    running: Vec<Running>,
    pending: Vec<Pending>,
    clock: f64,
    last_go: Option<f64>,
    next_instance: u64,
    log: VecDeque<LogEntry>,
    unsent_log: usize,
    tone: Option<StaticSoundHandle>,
    /// Files already opened and probed for the next cues, so GO doesn't wait on the disk.
    prepared: HashMap<PathBuf, StreamingSoundData<FromFileError>>,
    failed_prepare: Vec<PathBuf>,
    paused: bool,
    master_db: f64,
}

impl<B: Backend> Engine<B> {
    pub fn new(mut settings: AudioManagerSettings<B>, limiter_ceiling_db: f64) -> Result<Self, B::Error> {
        let mut main = MainTrackBuilder::new();
        let limiter = main.add_effect(LimiterBuilder { ceiling_db: limiter_ceiling_db as f32, ..Default::default() });
        settings.main_track_builder = main;
        let manager = AudioManager::new(settings)?;
        Ok(Self {
            manager,
            meter: limiter.meter,
            show: Show::default(),
            base_dir: None,
            playhead: None,
            running: vec![],
            pending: vec![],
            clock: 0.0,
            last_go: None,
            next_instance: 1,
            log: VecDeque::new(),
            unsent_log: 0,
            tone: None,
            prepared: HashMap::new(),
            failed_prepare: vec![],
            paused: false,
            master_db: 0.0,
        })
    }

    pub fn backend_mut(&mut self) -> &mut B {
        self.manager.backend_mut()
    }

    pub fn show(&self) -> &Show {
        &self.show
    }

    pub fn playhead(&self) -> Option<&str> {
        self.playhead.as_deref()
    }

    /// Replaces the show (the UI calls this after every edit and on open).
    pub fn set_show(&mut self, show: Show, base_dir: Option<PathBuf>) {
        // The limiter picks up the (possibly changed) ceiling on its next audio block.
        self.meter.set_ceiling_db(show.settings.limiter_ceiling_db as f32);
        if (show.settings.master_db - self.master_db).abs() > 1e-6 {
            self.set_master_db(show.settings.master_db);
        }
        self.show = show;
        self.base_dir = base_dir;
        self.failed_prepare.clear();
        let keep = self.playhead.as_ref().is_some_and(|id| self.show.go_queue().iter().any(|c| &c.id == id));
        if !keep {
            self.playhead = self.show.first_in_queue().map(|c| c.id.clone());
        }
        // Drop timers for cues that no longer exist.
        let show = &self.show;
        self.pending.retain(|p| show.cue(&p.cue_id).is_some());
    }

    /// Moves the playhead without firing anything (Skip to / clicking in Build).
    pub fn set_playhead(&mut self, id: Option<String>) {
        self.playhead = id.filter(|id| self.show.cue(id).is_some());
    }

    pub fn go(&mut self) -> GoResult {
        let guard = self.show.settings.double_go_ms as f64 / 1000.0;
        if let Some(t) = self.last_go {
            if self.clock - t < guard {
                return GoResult::Ignored;
            }
        }
        let Some(id) = self.playhead.clone() else { return GoResult::EndOfShow };
        if self.paused {
            // GO while paused resumes everything first, so nothing stays stuck.
            self.toggle_pause_all();
        }
        self.last_go = Some(self.clock);
        self.go_cue(&id, "go");
        GoResult::Fired
    }

    /// Fires a cue as if GO was pressed on it, and moves the playhead past it.
    fn go_cue(&mut self, id: &str, kind: &str) {
        let Some(cue) = self.show.cue(id).cloned() else { return };
        self.playhead = self.show.next_in_queue(id).map(|c| c.id.clone());
        if let Some(fade) = cue.fade_go {
            for r in self.running.iter_mut().filter(|r| !r.stopping) {
                r.sound.stop(tween(fade, r.cue.curve));
                r.stopping = true;
            }
            self.pending.clear();
        }
        self.push_log(kind, Some(&cue), format!("{} {}", cue.number, cue.name));
        if cue.pre_wait > 0.0 {
            self.pending.push(Pending { at: self.clock + cue.pre_wait, cue_id: cue.id, kind: PendingKind::PreWait, parent: None });
        } else {
            self.fire(&cue, None);
        }
    }

    fn fire(&mut self, cue: &Cue, parent: Option<u64>) {
        match self.start_sound(cue, parent, None, 0.0) {
            Ok(instance) => {
                // Attached cues: due at their moment inside this cue's file.
                let children: Vec<Cue> = self.show.children_of(&cue.id).cloned().collect();
                for ch in children {
                    let at = ch.attach.as_ref().map(|a| a.at).unwrap_or(0.0) - cue.trim_in;
                    if at >= 0.0 {
                        self.pending.push(Pending {
                            at: self.clock + at + ch.pre_wait,
                            cue_id: ch.id.clone(),
                            kind: PendingKind::Attached,
                            parent: Some(instance),
                        });
                    }
                }
                if let Follow::AfterStart { delay } = cue.follow {
                    if let Some(next) = self.show.next_in_queue(&cue.id) {
                        self.pending.push(Pending {
                            at: self.clock + delay.max(0.0),
                            cue_id: next.id.clone(),
                            kind: PendingKind::Follow,
                            parent: None,
                        });
                    }
                }
            }
            Err(e) => {
                self.push_log("skip", Some(cue), format!("{} {}: {e}", cue.number, cue.name));
                // A missing file must not stall an automatic sequence.
                if matches!(cue.follow, Follow::AfterEnd | Follow::AfterStart { .. }) && parent.is_none() {
                    if let Some(next) = self.show.next_in_queue(&cue.id).map(|c| c.id.clone()) {
                        self.go_cue(&next, "auto");
                    }
                }
            }
        }
    }

    /// Starts one sound. `from` is a position in the file (seconds) to start at
    /// instead of the trim-in point (rehearsal, resume after a crash).
    fn start_sound(&mut self, cue: &Cue, parent: Option<u64>, pad: Option<String>, from: f64) -> Result<u64, String> {
        let path = self.show.resolve(self.base_dir.as_deref(), &cue.file);
        let data = match self.prepared.remove(&path) {
            Some(d) => d,
            None => StreamingSoundData::from_file(&path).map_err(|e| format!("cannot open {}: {e}", path.display()))?,
        };
        let file_len = data.unsliced_duration().as_secs_f64();
        let start = cue.trim_in.clamp(0.0, file_len);
        let end = cue.trim_out.unwrap_or(file_len).clamp(start, file_len);
        let len = end - start;

        let mut data = data
            .slice(start..end)
            .volume(Decibels(cue.level_db(&self.show.settings) as f32))
            .panning(Panning(cue.pan.clamp(-1.0, 1.0) as f32));
        if from > start {
            data = data.start_position((from - start).min(len));
        }
        if cue.fade_in > 0.0 && from <= start {
            data = data.fade_in_tween(tween(cue.fade_in, cue.curve));
        }
        let vamping = cue.vamp.is_some_and(|v| v.on && v.b > v.a);
        if vamping {
            let v = cue.vamp.unwrap();
            data = data.loop_region((v.a - start).max(0.0)..(v.b - start).min(len));
        } else if cue.play_count != 1 {
            data = data.loop_region(0.0..len);
        }

        let mut tb = TrackBuilder::new();
        if let Some(hz) = cue.hpf {
            tb.add_effect(FilterBuilder::new().mode(FilterMode::HighPass).cutoff(hz).resonance(0.0));
        }
        for (i, b) in cue.eq.iter().enumerate() {
            if b.on && b.gain_db.abs() > 0.01 {
                let kind = match i {
                    0 => EqFilterKind::LowShelf,
                    3 => EqFilterKind::HighShelf,
                    _ => EqFilterKind::Bell,
                };
                tb.add_effect(EqFilterBuilder::new(kind, b.freq, Decibels(b.gain_db as f32), b.q));
            }
        }
        if cue.comp.on {
            let c = cue.comp;
            tb.add_effect(
                CompressorBuilder::new()
                    .threshold(c.threshold_db)
                    .ratio(c.ratio)
                    .attack_duration(Duration::from_secs_f64(c.attack_ms / 1000.0))
                    .release_duration(Duration::from_secs_f64(c.release_ms / 1000.0))
                    .makeup_gain(Decibels(c.makeup_db as f32)),
            );
        }
        let mut track = self.manager.add_sub_track(tb).map_err(|e| format!("too many cues playing: {e}"))?;
        let sound = track.play(data).map_err(|e| format!("cannot play: {e}"))?;

        let instance = self.next_instance;
        self.next_instance += 1;
        self.running.push(Running {
            instance,
            cue: cue.clone(),
            sound,
            track,
            parent,
            pad,
            len,
            pass: 1,
            last_pos: 0.0,
            fading_out: false,
            stopping: false,
            under: false,
            vamping,
        });
        Ok(instance)
    }

    /// Advances timers and housekeeping. `dt` is seconds since the last tick.
    pub fn tick(&mut self, dt: f64) {
        self.clock += dt;
        if self.paused {
            // Hold every timer: shift them forward by the time spent paused.
            for p in &mut self.pending {
                p.at += dt;
            }
        }

        // Due timers, earliest first.
        self.pending.sort_by(|a, b| a.at.total_cmp(&b.at));
        while self.pending.first().is_some_and(|p| p.at <= self.clock) {
            let p = self.pending.remove(0);
            let Some(cue) = self.show.cue(&p.cue_id).cloned() else { continue };
            match p.kind {
                PendingKind::PreWait => self.fire(&cue, None),
                PendingKind::Follow => self.go_cue(&cue.id, "auto"),
                PendingKind::Attached => {
                    if self.running.iter().any(|r| Some(r.instance) == p.parent && !r.stopping) {
                        self.push_log("attached", Some(&cue), format!("{} {}", cue.number, cue.name));
                        self.fire(&cue, p.parent);
                    }
                }
            }
        }

        let mut finished: Vec<(u64, bool)> = vec![];
        for r in &mut self.running {
            let pos = r.sound.position();
            // A position that jumps back means the loop region wrapped: one pass done.
            // Note: kira's streaming decoder buffers ~0.34 s ahead (16 384 frames at
            // 48 kHz), so loop changes land that much later. Fine for passes longer
            // than that; very short repeating jingles may play one pass too many.
            if !r.vamping && pos + 0.05 < r.last_pos {
                r.pass += 1;
                if r.cue.play_count != 0 && r.pass >= r.cue.play_count {
                    r.sound.set_loop_region(None);
                }
            }
            r.last_pos = pos;
            let last_pass = r.cue.play_count != 0 && r.pass >= r.cue.play_count;
            if last_pass && !r.vamping && !r.fading_out && !r.stopping && r.cue.fade_out > 0.0 && pos >= r.len - r.cue.fade_out {
                r.sound.stop(tween((r.len - pos).max(0.01), r.cue.curve));
                r.fading_out = true;
            }
            if r.sound.state() == PlaybackState::Stopped {
                finished.push((r.instance, r.stopping));
            }
        }

        for (instance, stopped_by_operator) in finished {
            let Some(i) = self.running.iter().position(|r| r.instance == instance) else { continue };
            let r = self.running.remove(i);
            self.stop_children(instance);
            if !stopped_by_operator && r.parent.is_none() && r.pad.is_none() && r.cue.follow == Follow::AfterEnd {
                if let Some(next) = self.show.next_in_queue(&r.cue.id).map(|c| c.id.clone()) {
                    self.go_cue(&next, "auto");
                }
            }
        }
        self.prepare_upcoming();
    }

    /// Opens the files of the standing-by cue, the two after it and their attached
    /// cues ahead of time. Opening = reading the header and probing the format,
    /// which can take tens of milliseconds on a slow disk; doing it now keeps GO instant.
    fn prepare_upcoming(&mut self) {
        let mut wanted: Vec<PathBuf> = vec![];
        let mut id = self.playhead.clone();
        for _ in 0..3 {
            let Some(cid) = id else { break };
            if let Some(c) = self.show.cue(&cid) {
                wanted.push(self.show.resolve(self.base_dir.as_deref(), &c.file));
                for ch in self.show.children_of(&cid) {
                    wanted.push(self.show.resolve(self.base_dir.as_deref(), &ch.file));
                }
            }
            id = self.show.next_in_queue(&cid).map(|c| c.id.clone());
        }
        self.prepared.retain(|p, _| wanted.contains(p));
        // At most one new file per tick, so a tick never stalls for long.
        if let Some(p) = wanted.into_iter().find(|p| !self.prepared.contains_key(p) && !self.failed_prepare.contains(p)) {
            match StreamingSoundData::from_file(&p) {
                Ok(d) => {
                    self.prepared.insert(p, d);
                }
                Err(_) => {
                    // Missing or unreadable: GO will log it. Don't retry every tick.
                    self.failed_prepare.push(p);
                }
            }
        }
    }

    fn stop_children(&mut self, parent: u64) {
        self.pending.retain(|p| p.parent != Some(parent));
        let mut kids = vec![];
        for r in self.running.iter_mut().filter(|r| r.parent == Some(parent) && !r.stopping) {
            r.sound.stop(tween(r.cue.stop_fade, r.cue.curve));
            r.stopping = true;
            kids.push(r.instance);
        }
        for k in kids {
            self.stop_children(k);
        }
    }

    /// Stops one running cue (and what hangs on it) with its own stop fade.
    pub fn stop_cue(&mut self, cue_id: &str) {
        let ids: Vec<u64> = self.running.iter().filter(|r| r.cue.id == cue_id && !r.stopping).map(|r| r.instance).collect();
        for id in ids {
            if let Some(r) = self.running.iter_mut().find(|r| r.instance == id) {
                r.sound.stop(tween(r.cue.stop_fade, r.cue.curve));
                r.stopping = true;
                let c = r.cue.clone();
                self.push_log("stop", Some(&c), format!("{} {}", c.number, c.name));
            }
            self.stop_children(id);
        }
        self.pending.retain(|p| p.cue_id != cue_id);
    }

    /// The normal way to end things: everything fades over the stop-all time.
    pub fn stop_all(&mut self) {
        let fade = self.show.settings.stop_all_fade;
        self.stop_everything(fade, Curve::SCurve);
        self.push_log("stopAll", None, "Stop all".into());
    }

    /// Emergency: everything cut at once; pre-waits and follow triggers cancelled.
    pub fn panic(&mut self) {
        self.stop_everything(PANIC_FADE, Curve::Linear);
        self.push_log("panic", None, "Panic".into());
    }

    fn stop_everything(&mut self, fade: f64, curve: Curve) {
        self.paused = false;
        for r in &mut self.running {
            r.sound.stop(tween(fade, curve));
            r.stopping = true;
        }
        self.pending.clear();
        self.stop_tone();
    }

    /// Soundboard pad press. Pads play through the same chain and limiter as cues,
    /// never move the playhead, and Stop all / Panic stop them too.
    pub fn play_pad(&mut self, pad_id: &str) {
        let Some(pad) = self.show.pads.iter().find(|p| p.id == pad_id).cloned() else { return };
        let playing: Vec<u64> =
            self.running.iter().filter(|r| r.pad.as_deref() == Some(pad_id) && !r.stopping).map(|r| r.instance).collect();
        for r in self.running.iter_mut().filter(|r| playing.contains(&r.instance)) {
            let fade = if pad.mode == PadMode::OneShot { 0.02 } else { r.cue.stop_fade };
            r.sound.stop(tween(fade, r.cue.curve));
            r.stopping = true;
        }
        if !playing.is_empty() && pad.mode != PadMode::OneShot {
            self.push_log("pad", Some(&pad.cue), format!("pad {} off", pad.cue.name));
            return;
        }
        let mut cue = pad.cue.clone();
        cue.follow = Follow::None;
        cue.play_count = if pad.mode == PadMode::Loop { 0 } else { 1 };
        match self.start_sound(&cue, None, Some(pad.id.clone()), 0.0) {
            Ok(_) => self.push_log("pad", Some(&cue), format!("pad {}", cue.name)),
            Err(e) => self.push_log("skip", Some(&cue), format!("pad {}: {e}", cue.name)),
        }
    }

    /// Rehearsal: start a cue at a point inside it (a marker), as if GO was pressed.
    /// The playhead moves on past it; follow triggers and attached cues still work.
    pub fn go_from(&mut self, cue_id: &str, at: f64) {
        let Some(cue) = self.show.cue(cue_id).cloned() else { return };
        self.playhead = self.show.next_in_queue(cue_id).map(|c| c.id.clone());
        self.push_log("rehearsal", Some(&cue), format!("{} {} from {:.1} s", cue.number, cue.name, at));
        if let Err(e) = self.start_sound(&cue, None, None, at) {
            self.push_log("skip", Some(&cue), format!("{} {}: {e}", cue.number, cue.name));
        }
    }

    /// Plays one cue on its own: no playhead, no follow, no attached cues.
    /// Used for headphone preview (on a second engine) and for resuming after a crash.
    pub fn play_one(&mut self, cue: &Cue, at: f64) -> Result<(), String> {
        let mut c = cue.clone();
        c.follow = Follow::None;
        self.start_sound(&c, None, None, at).map(|_| ())
    }

    /// Calibration or line-check tone on the show output.
    /// `hz`: the sine's frequency (ignored for pink noise).
    pub fn start_tone(&mut self, kind: ToneKind, target_lufs: f64, hz: f32) {
        self.stop_tone();
        let data = tone::make(kind, target_lufs, hz);
        match self.manager.play(data) {
            Ok(h) => {
                self.tone = Some(h);
                self.push_log("tone", None, format!("tone {kind:?} on"));
            }
            Err(e) => self.push_log("skip", None, format!("tone: {e}")),
        }
    }

    pub fn stop_tone(&mut self) {
        if let Some(mut h) = self.tone.take() {
            h.stop(tween(0.2, Curve::Linear));
        }
    }

    pub fn tone_playing(&self) -> bool {
        self.tone.as_ref().is_some_and(|h| h.state() != PlaybackState::Stopped)
    }

    /// Under (U): drop the cue to its under level, or bring it back up.
    pub fn toggle_under(&mut self, cue_id: Option<&str>) {
        let s = &self.show.settings;
        let (fade, default_under) = (s.under_fade, s.under_db);
        let target = cue_id.map(str::to_string).or_else(|| {
            self.running.iter().rev().find(|r| !r.stopping && r.parent.is_none()).map(|r| r.cue.id.clone())
        });
        let Some(target) = target else { return };
        for r in self.running.iter_mut().filter(|r| r.cue.id == target && !r.stopping) {
            r.under = !r.under;
            let db = if r.under { r.cue.under_db.unwrap_or(default_under) } else { 0.0 };
            r.track.set_volume(Decibels(db as f32), tween(fade, Curve::SCurve));
        }
    }

    /// Release (V): the vamp loop stops repeating and the song plays on.
    pub fn release_vamp(&mut self, cue_id: Option<&str>) {
        for r in self.running.iter_mut().filter(|r| r.vamping && cue_id.is_none_or(|id| id == r.cue.id)) {
            r.vamping = false;
            if r.cue.play_count == 1 {
                r.sound.set_loop_region(None);
            } else {
                r.sound.set_loop_region(0.0..r.len);
            }
            r.last_pos = r.sound.position();
        }
    }

    /// Adds a line to the show log from the host (crash resume, output fallback).
    pub fn note(&mut self, kind: &str, text: String) {
        self.push_log(kind, None, text);
    }

    /// Pause all (P): every running cue and pad holds its place; pre-wait and follow
    /// timers hold too. Press again to resume. Panic and Stop all still work while paused.
    pub fn toggle_pause_all(&mut self) -> bool {
        self.paused = !self.paused;
        let fade = tween(0.3, Curve::SCurve);
        for r in self.running.iter_mut().filter(|r| !r.stopping) {
            if self.paused {
                r.sound.pause(fade);
            } else {
                r.sound.resume(fade);
            }
        }
        self.push_log(if self.paused { "pause" } else { "resume" }, None, if self.paused { "Pause all".into() } else { "Resume all".into() });
        self.paused
    }

    /// Master fader, in dB (0 = unity). Sits before the limiter.
    pub fn set_master_db(&mut self, db: f64) {
        self.master_db = db.clamp(-60.0, 10.0);
        let v = if self.master_db <= -59.9 { Decibels::SILENCE } else { Decibels(self.master_db as f32) };
        self.manager.main_track().set_volume(v, tween(0.05, Curve::Linear));
    }

    pub fn is_playing(&self) -> bool {
        !self.running.is_empty() || !self.pending.is_empty()
    }

    pub fn state(&mut self) -> EngineState {
        let new_log: Vec<LogEntry> = self.log.iter().skip(self.log.len() - self.unsent_log).cloned().collect();
        self.unsent_log = 0;
        EngineState {
            clock: self.clock,
            paused: self.paused,
            master_db: self.master_db,
            playhead: self.playhead.clone(),
            running: self
                .running
                .iter()
                .map(|r| {
                    let pos = r.sound.position();
                    let abs = r.cue.trim_in + pos;
                    let next_marker = r
                        .cue
                        .markers
                        .iter()
                        .filter(|m| m.t > abs)
                        .min_by(|a, b| a.t.total_cmp(&b.t))
                        .map(|m| (m.label.clone(), m.t - abs));
                    let passes_left = if r.cue.play_count == 0 { 0 } else { r.cue.play_count.saturating_sub(r.pass) };
                    RunningInfo {
                        instance: r.instance,
                        cue_id: r.cue.id.clone(),
                        number: r.cue.number.clone(),
                        name: r.cue.name.clone(),
                        position: pos,
                        length: r.len,
                        remaining: (r.len - pos).max(0.0) + passes_left as f64 * r.len,
                        pass: r.pass,
                        play_count: r.cue.play_count,
                        under: r.under,
                        vamping: r.vamping,
                        stopping: r.stopping,
                        attached: r.parent.is_some(),
                        pad_id: r.pad.clone(),
                        duck_bg: r.cue.duck_bg && !r.stopping,
                        next_marker,
                    }
                })
                .collect(),
            pending: self
                .pending
                .iter()
                .map(|p| PendingInfo { cue_id: p.cue_id.clone(), kind: p.kind, in_secs: (p.at - self.clock).max(0.0) })
                .collect(),
            meter: self.meter.take(),
            new_log,
        }
    }

    fn push_log(&mut self, kind: &str, cue: Option<&Cue>, text: String) {
        let wall_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        self.log.push_back(LogEntry { clock: self.clock, wall_ms, kind: kind.into(), cue_id: cue.map(|c| c.id.clone()), text });
        self.unsent_log += 1;
        while self.log.len() > 1000 {
            self.log.pop_front();
            self.unsent_log = self.unsent_log.min(self.log.len());
        }
    }
}
