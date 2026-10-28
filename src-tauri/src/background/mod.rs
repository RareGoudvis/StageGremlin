//! Background music player (brief: "Background music player"; contract: docs/ipc-wave2.md,
//! section "Background player").
//!
//! The music plays in a second window that shows a web player (Spotify, YouTube Music, Beatport
//! Soundtrack, SoundCloud or YouTube). Three jobs, three places:
//!
//! - **Volume** (duck, restore, fades, level, source offset) goes through the Windows mixer, never
//!   through the page: `session_volume.rs`. One thread ("bg-volume", started by `start`) owns it and
//!   moves the volume in 20 ms steps.
//! - **Play / pause / next / previous and now playing** go through a small script in the page:
//!   `inject.js`. The page reports back through the `cueplay-bg` plugin's one command, `report`,
//!   the only thing the remote page is allowed to call (capabilities/background.json).
//! - **Auto-duck** listens to the engine's `engine://state`: a running cue with "Duck background"
//!   ducks; when none is left, it restores after a short hold. A manual Duck/Restore wins until the
//!   next GO of a ducking cue. Stop all and Panic never touch the background.
//!
//! The UI gets `bg://state` about 4 times a second.
//!
//! Wiring in lib.rs (see the end of this file for the list):
//!   `.plugin(background::plugin())`, `app.manage(background::start(app.handle().clone(), data_dir))`
//!   in setup, and the `bg_*` commands in `generate_handler!`.

mod mixer;
mod session_volume;
mod window;

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Emitter, Listener, Manager, Runtime, State};

use session_volume::SessionVolume;

// ---------------------------------------------------------------------------------------------
// Types (mirror docs/ipc-wave2.md; the UI copy is src/components/background/useBackground.ts)
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BgSource {
    Spotify,
    Ytmusic,
    Beatport,
    Soundtrack,
    Soundcloud,
    /// Plain YouTube (videos); YouTube Music is `Ytmusic`.
    Youtube,
}

/// Browser data folders: the main window's (portable: next to the .exe; None = the default), and the
/// root for the players' own engines (`<dataDir>/players/<account>`). Managed state, set in lib.rs.
pub struct WebviewDirs {
    pub main: Option<PathBuf>,
    pub players: PathBuf,
}

/// Every source, in the order the UI shows them.
pub const ALL_SOURCES: [BgSource; 6] =
    [BgSource::Spotify, BgSource::Ytmusic, BgSource::Beatport, BgSource::Soundtrack, BgSource::Soundcloud, BgSource::Youtube];

/// Level offset per source in dB, applied through the Windows mixer. Beatport plays loud club
/// masters that are not normalised, so it starts 6 dB lower.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BgOffsets {
    pub spotify: f32,
    pub ytmusic: f32,
    pub beatport: f32,
    pub soundtrack: f32,
    pub soundcloud: f32,
    pub youtube: f32,
}

impl Default for BgOffsets {
    fn default() -> Self {
        Self { spotify: 0.0, ytmusic: 0.0, beatport: -6.0, soundtrack: 0.0, soundcloud: 0.0, youtube: 0.0 }
    }
}

impl BgOffsets {
    fn get(&self, source: BgSource) -> f32 {
        match source {
            BgSource::Spotify => self.spotify,
            BgSource::Ytmusic => self.ytmusic,
            BgSource::Beatport => self.beatport,
            BgSource::Soundtrack => self.soundtrack,
            BgSource::Soundcloud => self.soundcloud,
            BgSource::Youtube => self.youtube,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BgConfig {
    /// How far Duck goes down, relative to the normal level (dB, negative).
    pub duck_db: f32,
    /// Seconds for Duck, and for the fade-out before a pause.
    pub duck_time: f32,
    /// Seconds for Restore, and for the fade-in after play.
    pub restore_time: f32,
    /// Seconds to wait after the last ducking cue ends before restoring, so a quick next cue
    /// doesn't make the music pump up and down.
    pub restore_hold: f32,
    pub auto_duck: bool,
    pub offsets: BgOffsets,
}

impl Default for BgConfig {
    fn default() -> Self {
        Self { duck_db: -30.0, duck_time: 1.5, restore_time: 3.0, restore_hold: 2.0, auto_duck: true, offsets: BgOffsets::default() }
    }
}

/// What the UI shows (`bg://state`, `bg_get_state`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BgState {
    pub source: Option<BgSource>,
    pub open: bool,
    pub visible: bool,
    pub playing: bool,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub position: Option<f64>,
    pub duration: Option<f64>,
    pub level_db: f32,
    pub ducked: bool,
    /// True when Windows volume control works (we found the player's audio session).
    pub session_found: bool,
    pub error: Option<String>,
    /// Rows the page shows (playlist / queue), best effort. null = not available for this source.
    pub tracks: Option<Vec<BgTrack>>,
    /// Sources with a window open (filled in by the volume thread, which can see the windows).
    #[serde(default)]
    pub open_sources: Vec<BgSource>,
    /// Every service that reported, with its own state and fader (for the decks and the tabs).
    pub players: Vec<PlayerState>,
    /// What is on deck A and deck B, and which one is on air (0 = A, 1 = B).
    pub decks: [Option<BgSource>; 2],
    pub on_air: usize,
    /// Low spec mode: all services in one engine (no separate faders, swaps pause/start instead).
    pub low_spec: bool,
}

/// One service's player, as the decks and tabs show it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerState {
    pub source: BgSource,
    pub playing: bool,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub position: Option<f64>,
    pub duration: Option<f64>,
    /// Its own fader (dB, 0 = full).
    pub level_db: f32,
    /// Faded out (crossfaded away or paused with a fade).
    pub held: bool,
    /// Is someone signed in to the service in this player? None = can't tell (yet).
    pub signed_in: Option<bool>,
    /// Spotify: how the last move to another device went (None = not tried).
    pub connect: Option<ConnectResult>,
}

/// Spotify Connect: the outcome of the last click through Spotify's device list (inject.js, connect).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ConnectResult {
    /// "ok", "no-button" (Spotify's device button not found) or "no-device" (no row matched).
    pub state: String,
    /// The row clicked.
    pub device: Option<String>,
    /// "no-device": what Spotify does list.
    pub devices: Vec<String>,
    /// When (page clock, ms): tells a fresh outcome from an old one.
    pub at: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BgTrack {
    pub title: String,
    #[serde(default)]
    pub artist: Option<String>,
}

/// What `inject.js` sends twice a second.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PageReport {
    pub playing: bool,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub position: Option<f64>,
    pub duration: Option<f64>,
    pub has_media_session: bool,
    pub url: Option<String>,
    pub tracks: Option<Vec<BgTrack>>,
    /// See PlayerState::signed_in (inject.js, signedIn).
    pub signed_in: Option<bool>,
    /// See PlayerState::connect.
    pub connect: Option<ConnectResult>,
}

/// Saved per machine in `<dataDir>/background.json` (later per show, under `show.background`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Saved {
    source: Option<BgSource>,
    level_db: f32,
    config: BgConfig,
    /// One shared browser engine for all services (see window.rs).
    low_spec: bool,
}

impl Default for Saved {
    fn default() -> Self {
        Self { source: None, level_db: 0.0, config: BgConfig::default(), low_spec: false }
    }
}

// ---------------------------------------------------------------------------------------------
// Timing constants
// ---------------------------------------------------------------------------------------------

/// Volume step. 20 ms steps are smooth to the ear and cheap for Windows.
const TICK: Duration = Duration::from_millis(20);
/// Look for new audio sessions this often (the page creates one when it starts playing).
const SESSION_REFRESH: Duration = Duration::from_secs(1);
/// `bg://state` rate (~4 Hz).
const EMIT_EVERY: Duration = Duration::from_millis(250);
/// Anything at or below this is treated as silence (volume 0).
const SILENCE_DB: f32 = -60.0;
/// Fade used when the level slider or settings change, so a drag never clicks.
const LEVEL_FADE: f32 = 0.3;
/// After a faded pause: wait this long before putting the volume back (silently, while paused),
/// so the last bit of buffered audio is not heard.
const PAUSE_SETTLE: Duration = Duration::from_millis(400);

const JS_PLAY: &str = "window.__cueplayBg && window.__cueplayBg.play()";
const JS_PAUSE: &str = "window.__cueplayBg && window.__cueplayBg.pause()";
const JS_NEXT: &str = "window.__cueplayBg && window.__cueplayBg.next()";
const JS_PREV: &str = "window.__cueplayBg && window.__cueplayBg.prev()";

/// Spotify: set shuffle (on/off) and repeat ("off", "all", "one"); None leaves that one as it is.
/// Clicks Spotify's own buttons (inject.js, shuffleRepeat).
#[tauri::command]
pub fn bg_shuffle_repeat(app: AppHandle, state: State<'_, BgHandle>, shuffle: Option<bool>, repeat: Option<String>) -> Result<(), String> {
    if app.get_webview_window(&window::label(BgSource::Spotify)).is_none() {
        return Err("Open Spotify in the background player first.".into());
    }
    let js = format!(
        "window.__cueplayBg && window.__cueplayBg.shuffleRepeat({}, {})",
        serde_json::to_string(&shuffle).map_err(|e| e.to_string())?,
        serde_json::to_string(&repeat).map_err(|e| e.to_string())?
    );
    state.lock().evals_on.push((BgSource::Spotify, js));
    Ok(())
}

/// Spotify: play on another Spotify Connect device (`names`: the names it may have, best first), or
/// back in the player window itself (empty). Clicks through Spotify's own device list (inject.js,
/// connect); the outcome comes back in the player's `connect`.
#[tauri::command]
pub fn bg_spotify_connect(app: AppHandle, state: State<'_, BgHandle>, names: Vec<String>) -> Result<(), String> {
    if app.get_webview_window(&window::label(BgSource::Spotify)).is_none() {
        return Err("Open Spotify in the background player first.".into());
    }
    let js = format!("window.__cueplayBg && window.__cueplayBg.connect({})", serde_json::to_string(&names).map_err(|e| e.to_string())?);
    state.lock().evals_on.push((BgSource::Spotify, js));
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq)]
enum PausePhase {
    None,
    /// Fading to silence; pause the page once silent.
    FadingOut,
    /// Page told to pause; put the volume back at this moment.
    Settling(Instant),
}

struct Inner {
    data_file: Option<PathBuf>,
    source: Option<BgSource>,
    open: bool,
    visible: bool,
    level_db: f32,
    config: BgConfig,

    page: PageReport,
    page_at: Option<Instant>,

    ducked: bool,
    /// Set by a manual Duck/Restore; auto-duck leaves the music alone until the next GO.
    manual_override: bool,
    /// The current duck was made by auto-duck (so auto-duck may also restore it).
    auto_ducked: bool,
    restore_at: Option<Instant>,
    /// Running cue instances that duck the background, from the latest `engine://state`.
    engine_duck: Vec<u64>,
    /// The ducking instances we already reacted to (a new one = a new GO).
    seen_duck: HashSet<u64>,

    /// Fading to silence for a pause.
    silent: bool,
    pause_phase: PausePhase,
    /// Next volume change starts from silence (play with fade-in).
    jump_to_silence: bool,
    /// Fade time for the next volume change.
    next_fade: f32,
    /// JavaScript the volume thread should run in the page, after the volume step.
    evals: Vec<String>,
    /// The same, for one particular service's page (decks).
    evals_on: Vec<(BgSource, String)>,
    /// The faders, decks and crossfade (mixer.rs).
    mixer: mixer::Mixer,
    /// Each service's latest report (`page` is the active one's).
    pages: HashMap<BgSource, PageReport>,

    session_found: bool,
    error: Option<String>,
}

impl Inner {
    fn target_db(&self) -> f32 {
        if self.silent {
            return SILENCE_DB;
        }
        let offset = self.source.map(|s| self.config.offsets.get(s)).unwrap_or(0.0);
        let duck = if self.ducked { self.config.duck_db } else { 0.0 };
        // 0 dB is the most Windows can give (the session slider at 100 %).
        (self.level_db + offset + duck).clamp(SILENCE_DB, 0.0)
    }

    fn snapshot(&self) -> BgState {
        BgState {
            source: self.source,
            open: self.open,
            visible: self.visible,
            playing: self.open && self.page.playing,
            title: self.page.title.clone(),
            artist: self.page.artist.clone(),
            position: self.page.position,
            duration: self.page.duration,
            level_db: self.level_db,
            ducked: self.ducked,
            session_found: self.session_found,
            error: self.error.clone(),
            tracks: self.page.tracks.clone(),
            open_sources: Vec::new(),
            players: ALL_SOURCES
                .iter()
                .filter_map(|src| {
                    self.pages.get(src).map(|p| PlayerState {
                        source: *src,
                        playing: p.playing,
                        title: p.title.clone(),
                        artist: p.artist.clone(),
                        position: p.position,
                        duration: p.duration,
                        level_db: self.mixer.level(*src),
                        held: self.mixer.is_held(*src),
                        signed_in: p.signed_in,
                        connect: p.connect.clone(),
                    })
                })
                .collect(),
            decks: self.mixer.decks,
            on_air: self.mixer.on_air,
            low_spec: window::low_spec(),
        }
    }

    /// Automatic ducking, called every tick.
    fn auto_duck_tick(&mut self, now: Instant) {
        let current: HashSet<u64> = self.engine_duck.iter().copied().collect();
        let new_go = current.iter().any(|i| !self.seen_duck.contains(i));
        self.seen_duck = current;
        let any = !self.seen_duck.is_empty();

        if new_go {
            // A new GO of a ducking cue ends a manual override.
            self.manual_override = false;
        }
        if !self.config.auto_duck || self.manual_override {
            self.restore_at = None;
            return;
        }
        if any {
            self.restore_at = None;
            if !self.ducked {
                self.ducked = true;
                self.next_fade = self.config.duck_time;
            }
            self.auto_ducked = true;
        } else if self.auto_ducked && self.ducked {
            match self.restore_at {
                None => self.restore_at = Some(now + secs(self.config.restore_hold)),
                Some(at) if now >= at => {
                    self.ducked = false;
                    self.auto_ducked = false;
                    self.restore_at = None;
                    self.next_fade = self.config.restore_time;
                }
                Some(_) => {}
            }
        }
    }

    fn save(&self) {
        let Some(path) = &self.data_file else { return };
        let saved = Saved { source: self.source, level_db: self.level_db, config: self.config.clone(), low_spec: window::low_spec() };
        if let Ok(text) = serde_json::to_string_pretty(&saved) {
            let _ = std::fs::write(path, text);
        }
    }
}

fn secs(s: f32) -> Duration {
    Duration::from_secs_f32(s.max(0.0))
}

fn db_to_gain(db: f32) -> f32 {
    if db <= SILENCE_DB {
        0.0
    } else {
        10f32.powf(db / 20.0).min(1.0)
    }
}

/// Managed Tauri state: a handle to the shared background state.
pub struct BgHandle {
    shared: Arc<Mutex<Inner>>,
}

impl BgHandle {
    fn lock(&self) -> MutexGuard<'_, Inner> {
        // A panic elsewhere must not take the background controls down with it.
        self.shared.lock().unwrap_or_else(|p| p.into_inner())
    }

    pub(crate) fn set_visible(&self, visible: bool) {
        self.lock().visible = visible;
    }

    fn store_report(&self, source: BgSource, report: PageReport) {
        let mut s = self.lock();
        if window::active() == Some(source) {
            s.page = report.clone();
            s.page_at = Some(Instant::now());
        }
        s.pages.insert(source, report);
    }
}

// ---------------------------------------------------------------------------------------------
// Start-up and the volume thread
// ---------------------------------------------------------------------------------------------

/// Minimal view of `engine://state`: only what auto-duck needs.
#[derive(Deserialize)]
struct EngineLite {
    #[serde(default)]
    running: Vec<RunningLite>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunningLite {
    instance: u64,
    /// Already false for a cue that is stopping (the engine sets it that way).
    #[serde(default)]
    duck_bg: bool,
    #[serde(default)]
    stopping: bool,
}

/// Loads the saved settings, listens to the engine and starts the volume thread.
/// Call once from `setup` and `app.manage(...)` the result.
pub fn start(app: AppHandle, data_dir: PathBuf) -> BgHandle {
    let data_file = data_dir.join("background.json");
    let saved: Saved = std::fs::read_to_string(&data_file)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();

    window::set_low_spec(saved.low_spec);
    let shared = Arc::new(Mutex::new(Inner {
        data_file: Some(data_file),
        source: saved.source,
        open: false,
        visible: false,
        level_db: saved.level_db,
        config: saved.config,
        page: PageReport::default(),
        page_at: None,
        ducked: false,
        manual_override: false,
        auto_ducked: false,
        restore_at: None,
        engine_duck: Vec::new(),
        seen_duck: HashSet::new(),
        silent: false,
        pause_phase: PausePhase::None,
        jump_to_silence: false,
        next_fade: 0.0,
        evals: Vec::new(),
        evals_on: Vec::new(),
        mixer: mixer::Mixer::default(),
        pages: HashMap::new(),
        session_found: false,
        error: None,
    }));

    // Auto-duck input. The engine sends this ~30 times a second; we only copy a few numbers.
    let for_listener = shared.clone();
    app.listen("engine://state", move |event| {
        if let Ok(state) = serde_json::from_str::<EngineLite>(event.payload()) {
            let ducking: Vec<u64> = state.running.iter().filter(|r| r.duck_bg && !r.stopping).map(|r| r.instance).collect();
            if let Ok(mut s) = for_listener.lock() {
                s.engine_duck = ducking;
            }
        }
    });

    let for_thread = shared.clone();
    let _ = std::thread::Builder::new()
        .name("bg-volume".into())
        .spawn(move || volume_thread(app, for_thread));

    BgHandle { shared }
}

struct Ramp {
    from: f32,
    to: f32,
    start: Instant,
    secs: f32,
}

fn volume_thread(app: AppHandle, shared: Arc<Mutex<Inner>>) {
    // Created on this thread: COM objects stay on the thread that made them.
    let mut sessions = SessionVolume::new();
    let mut current_db = SILENCE_DB;
    let mut first = true;
    let mut ramp: Option<Ramp> = None;
    // What we last gave Windows: the overall gain and each engine's fader gain.
    let mut applied: (f32, Vec<(u32, f32)>) = (-1.0, Vec::new());
    let mut last_refresh: Option<Instant> = None;
    let mut last_emit: Option<Instant> = None;
    let mut seen_main = false;

    loop {
        std::thread::sleep(TICK);
        let now = Instant::now();

        // The app is closing when the main window is gone: put the Windows volume back to 100 %
        // (Windows remembers per-app volumes) and close the player window so the app can exit.
        let main_exists = app.get_webview_window("main").is_some();
        seen_main |= main_exists;
        if seen_main && !main_exists {
            sessions.set(&|_| 1.0);
            for win in window::all(&app) {
                let _ = win.destroy();
            }
            return;
        }

        let evals;
        let evals_on;
        let open;
        let engines: Vec<(u32, f32)>;
        {
            let mut s = shared.lock().unwrap_or_else(|p| p.into_inner());
            open = s.open;
            s.auto_duck_tick(now);

            if s.jump_to_silence {
                s.jump_to_silence = false;
                current_db = SILENCE_DB;
                ramp = None;
            }

            // Start a new fade whenever the target moves.
            let target = s.target_db();
            if first {
                current_db = target;
                first = false;
            }
            let ramp_to = ramp.as_ref().map(|r| r.to);
            if ramp_to != Some(target) && (ramp.is_some() || current_db != target) {
                ramp = Some(Ramp { from: current_db, to: target, start: now, secs: s.next_fade });
            }

            // One step along the fade (in dB, so it sounds even from start to end).
            if let Some(r) = &ramp {
                let t = if r.secs <= 0.0 { 1.0 } else { now.duration_since(r.start).as_secs_f32() / r.secs };
                if t >= 1.0 {
                    current_db = r.to;
                    ramp = None;
                } else {
                    current_db = r.from + (r.to - r.from) * t;
                }
            }

            // Faded pause: once silent, pause the page; a moment later restore the volume.
            match s.pause_phase {
                PausePhase::FadingOut if ramp.is_none() && current_db <= SILENCE_DB => {
                    s.evals.push(JS_PAUSE.into());
                    s.pause_phase = PausePhase::Settling(now + PAUSE_SETTLE);
                }
                PausePhase::Settling(at) if now >= at => {
                    s.silent = false;
                    s.next_fade = 0.0;
                    s.pause_phase = PausePhase::None;
                }
                _ => {}
            }
            // The mixer: faders and crossfades; pages whose fade-out just ended get paused.
            for src in s.mixer.tick(now) {
                s.evals_on.push((src, JS_PAUSE.into()));
            }
            evals = std::mem::take(&mut s.evals);
            evals_on = std::mem::take(&mut s.evals_on);
            // Each engine's fader gain (services sharing an engine: the loudest of them). In low
            // spec mode there is one engine for all, so faders can't apply: full for everything.
            let mut per: Vec<(u32, f32)> = Vec::new();
            for src in ALL_SOURCES {
                let Some(pid) = window::engine_pid(src) else { continue };
                let g = if window::low_spec() { 1.0 } else { s.mixer.gain(src) };
                match per.iter_mut().find(|(p, _)| *p == pid) {
                    Some(e) => e.1 = e.1.max(g),
                    None => per.push((pid, g)),
                }
            }
            engines = per;
        }

        // Volume first, then page commands: a "play" then starts from silence, not full level.
        // Every engine gets the overall gain times its own fader; an engine we don't know (the main
        // window's) just the overall gain.
        let gain = db_to_gain(current_db);
        let gain_of = |engine: u32| gain * engines.iter().find(|(p, _)| *p == engine).map(|e| e.1).unwrap_or(1.0);
        let changed = (gain - applied.0).abs() > 0.0001
            || engines.len() != applied.1.len()
            || engines.iter().zip(&applied.1).any(|(a, b)| a.0 != b.0 || (a.1 - b.1).abs() > 0.0001);
        let refresh_due = last_refresh.is_none_or(|t| now.duration_since(t) >= SESSION_REFRESH);
        if open && refresh_due {
            last_refresh = Some(now);
            let found = sessions.refresh(&gain_of);
            applied = (gain, engines.clone());
            if let Ok(mut s) = shared.lock() {
                s.session_found = found > 0;
            }
        } else if changed {
            sessions.set(&gain_of);
            applied = (gain, engines.clone());
        }

        for js in evals {
            window::eval(&app, &js);
        }
        for (src, js) in evals_on {
            window::eval_on(&app, src, &js);
        }

        if last_emit.is_none_or(|t| now.duration_since(t) >= EMIT_EVERY) {
            last_emit = Some(now);
            let state = shared.lock().map(|s| s.snapshot());
            if let Ok(mut state) = state {
                state.open_sources = window::open_sources(&app);
                let _ = app.emit("bg://state", state);
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// The page's one command (plugin `cueplay-bg`, reachable from the remote page)
// ---------------------------------------------------------------------------------------------

#[tauri::command]
fn report<R: Runtime>(webview: tauri::Webview<R>, report: PageReport) {
    // Only player windows may report (the capability already limits it; this is a second lock
    // on the door). Every one reports for itself: the decks and tabs show each service's state.
    let Some(source) = window::source_of_label(webview.label()) else { return };
    if let Some(handle) = webview.app_handle().try_state::<BgHandle>() {
        handle.store_report(source, report);
    }
}

/// The tiny plugin that holds `report`. A plugin (instead of an app command) lets the remote
/// capability allow exactly this one command: `cueplay-bg:allow-report`.
pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("cueplay-bg")
        .invoke_handler(tauri::generate_handler![report])
        .build()
}

// ---------------------------------------------------------------------------------------------
// Commands for the UI (docs/ipc-wave2.md → Background player)
// ---------------------------------------------------------------------------------------------

/// Creates or navigates the background window. Async on purpose: creating a window from a
/// synchronous command can deadlock on Windows.
/// `link` (optional): a playlist page on that service to open (the AUDAC schedule uses it).
#[tauri::command]
pub async fn bg_open(app: AppHandle, source: BgSource, show: bool, link: Option<String>) -> Result<(), String> {
    let link = match link.as_deref().map(str::trim).filter(|l| !l.is_empty()) {
        Some(l) => {
            let url = tauri::Url::parse(l).map_err(|_| format!("Not a valid link: {l}"))?;
            if !window::link_allowed(source, &url) {
                return Err(format!("That link is not on the {source:?} website."));
            }
            Some(url)
        }
        None => None,
    };
    let handle = app.state::<BgHandle>();
    let (navigate, existed) = {
        let s = handle.lock();
        let existed = window::get(&app).is_some();
        // A link always loads, even when this source is already open.
        (s.source != Some(source) || !existed || link.is_some(), existed)
    };
    let _ = existed;
    let result = window::open(&app, source, show, link);
    let mut s = handle.lock();
    match &result {
        Ok(()) => {
            if navigate {
                s.page = PageReport::default();
                s.page_at = None;
            }
            s.source = Some(source);
            s.open = true;
            s.visible = show || (existed && s.visible);
            s.error = None;
            // The new page's audio session needs a fresh search.
            s.session_found = s.session_found && !navigate;
            s.next_fade = 0.0;
            s.save();
        }
        Err(e) => s.error = Some(format!("Could not open the background player: {e}")),
    }
    result
}

/// Close one source's window (its music stops); another open one becomes the active one.
#[tauri::command]
pub async fn bg_close(app: AppHandle, source: BgSource) -> Result<(), String> {
    window::close(&app, source);
    let state = app.state::<BgHandle>();
    let mut s = state.lock();
    s.mixer.forget(source);
    s.pages.remove(&source);
    s.source = window::active();
    s.open = window::get(&app).is_some();
    s.page = PageReport::default();
    s.page_at = None;
    Ok(())
}

/// Put a service on deck A (0) or B (1), or empty it (null).
#[tauri::command]
pub fn bg_set_deck(state: State<'_, BgHandle>, deck: usize, source: Option<BgSource>) -> Result<(), String> {
    let mut s = state.lock();
    let d = s.mixer.decks.get_mut(deck).ok_or("There are two decks: 0 and 1.")?;
    *d = source;
    Ok(())
}

/// The on-air deck fades out (and pauses), the other fades in and starts. `secs` 0 = a cut.
/// Low spec mode can't fade one service against another: it pauses one and starts the other.
#[tauri::command]
pub fn bg_crossfade(state: State<'_, BgHandle>, secs: f32) -> Result<(), String> {
    let mut s = state.lock();
    let secs = if window::low_spec() { 0.0 } else { secs.clamp(0.0, 30.0) };
    let (_, inn) = s.mixer.crossfade(secs, Instant::now()).ok_or("Put a service on both decks first.")?;
    s.evals_on.push((inn, JS_PLAY.into()));
    Ok(())
}

/// One service's own fader (dB, 0 = full, −60 = off).
#[tauri::command]
pub fn bg_set_fader(state: State<'_, BgHandle>, source: BgSource, db: f32) {
    state.lock().mixer.set_level(source, db, Instant::now());
}

/// Low spec mode on/off. The players change engine, so they close (and reopen when picked again).
#[tauri::command]
pub async fn bg_set_low_spec(app: AppHandle, on: bool) -> Result<(), String> {
    for win in window::all(&app) {
        let _ = win.destroy();
    }
    window::set_low_spec(on);
    let state = app.state::<BgHandle>();
    let mut s = state.lock();
    s.open = false;
    s.mixer = mixer::Mixer::default();
    s.pages.clear();
    s.save();
    Ok(())
}

#[tauri::command]
pub fn bg_hide(app: AppHandle, state: State<'_, BgHandle>) {
    window::hide(&app);
    state.set_visible(false);
}

/// Where the Background screen wants the player: physical pixels inside the main window's content.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct DockRect {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

/// Background screen: put the player over its middle area (`rect`), or `null` to take it away
/// (hidden, normal window again). Async: moving windows from a synchronous command can deadlock.
#[tauri::command]
pub async fn bg_dock(app: AppHandle, rect: Option<DockRect>) -> Result<(), String> {
    let state = app.state::<BgHandle>();
    match rect {
        Some(r) => {
            window::dock(&app, r.x, r.y, r.w, r.h)?;
            state.set_visible(window::get(&app).is_some());
        }
        None => {
            window::undock(&app);
            state.set_visible(false);
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BgCmd {
    Duck,
    Restore,
    Play,
    Pause,
    Next,
    Prev,
}

#[tauri::command]
pub fn bg_command(app: AppHandle, state: State<'_, BgHandle>, cmd: BgCmd, instant: bool, source: Option<BgSource>) -> Result<(), String> {
    // A deck (one particular service): play / pause with its own fader; next / previous on its page.
    // (Always through the deck's own fader: the overall pause would silence the other deck too.)
    if let Some(src) = source {
        if app.get_webview_window(&window::label(src)).is_none() {
            return Err("That service isn't open.".into());
        }
        let mut s = state.lock();
        let now = Instant::now();
        let (fade_out, fade_in) = (s.config.duck_time, s.config.restore_time);
        match cmd {
            BgCmd::Play => {
                s.mixer.fade_in(src, if instant { 0.0 } else { fade_in }, now);
                s.evals_on.push((src, JS_PLAY.into()));
            }
            BgCmd::Pause => s.mixer.fade_out_then_pause(src, if instant || window::low_spec() { 0.0 } else { fade_out }, now),
            BgCmd::Next => s.evals_on.push((src, JS_NEXT.into())),
            BgCmd::Prev => s.evals_on.push((src, JS_PREV.into())),
            BgCmd::Duck | BgCmd::Restore => {} // duck is for all background music, below
        }
        if !matches!(cmd, BgCmd::Duck | BgCmd::Restore) {
            return Ok(());
        }
    }
    let needs_page = matches!(cmd, BgCmd::Play | BgCmd::Pause | BgCmd::Next | BgCmd::Prev);
    if needs_page && window::get(&app).is_none() {
        return Err("The background player is not open. Pick a source first.".into());
    }
    let mut s = state.lock();
    match cmd {
        BgCmd::Duck | BgCmd::Restore => {
            s.ducked = matches!(cmd, BgCmd::Duck);
            s.manual_override = true;
            s.auto_ducked = false;
            s.restore_at = None;
            let time = if s.ducked { s.config.duck_time } else { s.config.restore_time };
            s.next_fade = if instant { 0.0 } else { time };
        }
        BgCmd::Play => {
            let was_quiet = s.silent || !s.page.playing;
            s.pause_phase = PausePhase::None;
            s.silent = false;
            if instant {
                s.next_fade = 0.0;
            } else {
                // Fade in from silence (only when it wasn't already playing).
                s.jump_to_silence = was_quiet;
                s.next_fade = s.config.restore_time;
            }
            s.evals.push(JS_PLAY.into());
        }
        BgCmd::Pause => {
            if instant {
                s.pause_phase = PausePhase::None;
                s.silent = false;
                s.next_fade = 0.0;
                s.evals.push(JS_PAUSE.into());
            } else {
                s.silent = true;
                s.next_fade = s.config.duck_time;
                s.pause_phase = PausePhase::FadingOut;
            }
        }
        BgCmd::Next => s.evals.push(JS_NEXT.into()),
        BgCmd::Prev => s.evals.push(JS_PREV.into()),
    }
    Ok(())
}

/// Plays one row of the track list (from `BgState.tracks`). The title is passed along so the
/// page can still find the row if the list changed since the last report.
#[tauri::command]
pub fn bg_play_track(app: AppHandle, state: State<'_, BgHandle>, index: u32, title: String) -> Result<(), String> {
    if window::get(&app).is_none() {
        return Err("The background player is not open. Pick a source first.".into());
    }
    // JSON-encoding the title makes it a safe JavaScript string, whatever characters it has.
    let title_js = serde_json::to_string(&title).map_err(|e| e.to_string())?;
    let mut s = state.lock();
    s.pause_phase = PausePhase::None;
    s.silent = false;
    s.evals.push(format!("window.__cueplayBg && window.__cueplayBg.playTrack({index}, {title_js})"));
    Ok(())
}

#[tauri::command]
pub fn bg_set_level(state: State<'_, BgHandle>, db: f32) {
    let mut s = state.lock();
    s.level_db = if db.is_finite() { db.clamp(SILENCE_DB, 12.0) } else { 0.0 };
    s.next_fade = LEVEL_FADE;
    s.save();
}

#[tauri::command]
pub fn bg_set_config(state: State<'_, BgHandle>, config: BgConfig) {
    let mut s = state.lock();
    s.config = config;
    s.next_fade = LEVEL_FADE;
    s.save();
}

#[tauri::command]
pub fn bg_get_state(app: AppHandle, state: State<'_, BgHandle>) -> BgState {
    let mut s = state.lock().snapshot();
    s.open_sources = window::open_sources(&app);
    s
}

/// Separate from `BgState` (which the contract fixes): the saved settings, so the Build panel
/// can show them before anything is opened.
#[tauri::command]
pub fn bg_get_config(state: State<'_, BgHandle>) -> BgConfig {
    state.lock().config.clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inner() -> Inner {
        Inner {
            data_file: None,
            source: Some(BgSource::Beatport),
            open: true,
            visible: false,
            level_db: 0.0,
            config: BgConfig::default(),
            page: PageReport::default(),
            page_at: None,
            ducked: false,
            manual_override: false,
            auto_ducked: false,
            restore_at: None,
            engine_duck: Vec::new(),
            seen_duck: HashSet::new(),
            silent: false,
            pause_phase: PausePhase::None,
            jump_to_silence: false,
            next_fade: 0.0,
            evals: Vec::new(),
            evals_on: Vec::new(),
            mixer: mixer::Mixer::default(),
            pages: HashMap::new(),
            session_found: false,
            error: None,
        }
    }

    #[test]
    fn target_applies_offset_duck_and_cap() {
        let mut s = inner();
        assert_eq!(s.target_db(), -6.0);
        s.ducked = true;
        assert_eq!(s.target_db(), -36.0);
        s.ducked = false;
        s.level_db = 10.0;
        assert_eq!(s.target_db(), 0.0, "never above 100 % in Windows");
        s.silent = true;
        assert_eq!(s.target_db(), SILENCE_DB);
        assert_eq!(db_to_gain(SILENCE_DB), 0.0);
    }

    #[test]
    fn auto_duck_restores_after_hold_and_respects_manual() {
        let mut s = inner();
        let t0 = Instant::now();
        s.engine_duck = vec![1];
        s.auto_duck_tick(t0);
        assert!(s.ducked);
        s.engine_duck.clear();
        s.auto_duck_tick(t0);
        assert!(s.ducked, "hold before restore");
        s.auto_duck_tick(t0 + Duration::from_secs(3));
        assert!(!s.ducked);

        // Manual restore during a ducking cue holds until the next GO.
        s.engine_duck = vec![2];
        s.auto_duck_tick(t0);
        assert!(s.ducked);
        s.ducked = false;
        s.manual_override = true;
        s.auto_duck_tick(t0);
        assert!(!s.ducked, "manual wins while the same cue plays");
        s.engine_duck = vec![2, 3];
        s.auto_duck_tick(t0);
        assert!(s.ducked, "new GO ends the override");
    }
}
