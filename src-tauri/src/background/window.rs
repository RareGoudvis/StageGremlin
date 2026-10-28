//! The background player windows: one Tauri window per source (label `background-<source>`, e.g.
//! `background-spotify`), so several services can stay open: Spotify keeps playing while you look for
//! a playlist on SoundCloud. One of them is ACTIVE: the one the controls, "now playing" and the
//! Background screen's middle area follow (`get`). Switching sources only switches which is active.
//!
//! ENGINES. Normally every ACCOUNT gets its own browser engine (its own data folder under
//! `<dataDir>/players/<account>`): Google (YouTube + YouTube Music), Spotify, SoundCloud, Beatport,
//! Soundtrack. Windows then sees each engine as a separate program with its own audio session, so
//! StageGremlin can give each service its own fader and crossfade between them (mod.rs, "mixer").
//! Logins are kept per engine: sign in once per account. LOW SPEC MODE puts every player in the main
//! window's engine instead (one browser engine, less memory): no separate faders then.
//!
//! - It uses the same WebView2 profile as the app, so sign-ins are kept between sessions
//!   (in portable mode that profile lives in `<exe folder>/data/webview`).
//! - Closing it with the X only hides it: the music keeps playing. It really closes when the
//!   main window closes.
//! - `inject.js` is loaded into every page it shows (remote control + now playing).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

use super::BgSource;

/// Every player window's label starts with this (capabilities/background.json matches `background-*`).
pub const LABEL_PREFIX: &str = "background-";

/// The source whose window the controls follow.
static ACTIVE: Mutex<Option<BgSource>> = Mutex::new(None);

/// Low spec mode: every player shares the main window's engine (see the module comment).
static LOW_SPEC: AtomicBool = AtomicBool::new(false);

/// Each source's browser engine process (WebView2's BrowserProcessId), to find its audio session.
static ENGINE_PID: Mutex<Option<HashMap<BgSource, u32>>> = Mutex::new(None);

pub fn set_low_spec(on: bool) {
    LOW_SPEC.store(on, Ordering::Relaxed);
}

pub fn low_spec() -> bool {
    LOW_SPEC.load(Ordering::Relaxed)
}

/// The engine process playing `source`, once known.
pub fn engine_pid(source: BgSource) -> Option<u32> {
    ENGINE_PID.lock().unwrap_or_else(|e| e.into_inner()).as_ref().and_then(|m| m.get(&source).copied())
}

/// Services that share a login share an engine (and so a fader): one Google sign-in covers both.
fn account(source: BgSource) -> &'static str {
    match source {
        BgSource::Ytmusic | BgSource::Youtube => "google",
        BgSource::Spotify => "spotify",
        BgSource::Beatport => "beatport",
        BgSource::Soundtrack => "soundtrack",
        BgSource::Soundcloud => "soundcloud",
    }
}

/// Where `source`'s engine keeps its data (logins, cache). None = the default folder (installed app,
/// low spec): the same one the main window uses.
fn data_dir(app: &AppHandle, source: BgSource) -> Option<PathBuf> {
    let dirs = app.try_state::<super::WebviewDirs>()?;
    if low_spec() {
        dirs.main.clone()
    } else {
        Some(dirs.players.join(account(source)))
    }
}

pub fn label(source: BgSource) -> String {
    // The serde name ("spotify", "ytmusic", …) is also what the UI uses.
    let name = serde_json::to_value(source).ok().and_then(|v| v.as_str().map(String::from)).unwrap_or_default();
    format!("{LABEL_PREFIX}{name}")
}

pub fn active() -> Option<BgSource> {
    *ACTIVE.lock().unwrap_or_else(|e| e.into_inner())
}

fn set_active(source: Option<BgSource>) {
    *ACTIVE.lock().unwrap_or_else(|e| e.into_inner()) = source;
}

/// Which source a player window's label belongs to.
pub fn source_of_label(label: &str) -> Option<BgSource> {
    super::ALL_SOURCES.iter().copied().find(|s| self::label(*s) == label)
}

/// Every open player window.
pub fn all(app: &AppHandle) -> Vec<WebviewWindow> {
    app.webview_windows().into_iter().filter(|(l, _)| l.starts_with(LABEL_PREFIX)).map(|(_, w)| w).collect()
}

/// The sources that have a window open (for the tabs' dots).
pub fn open_sources(app: &AppHandle) -> Vec<BgSource> {
    super::ALL_SOURCES.iter().copied().filter(|s| app.get_webview_window(&label(*s)).is_some()).collect()
}

/// Close one source's window (its music stops). Another open one becomes active.
pub fn close(app: &AppHandle, source: BgSource) {
    if let Some(win) = app.get_webview_window(&label(source)) {
        let _ = win.destroy();
    }
    if let Some(m) = ENGINE_PID.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
        m.remove(&source);
    }
    if active() == Some(source) {
        set_active(super::ALL_SOURCES.iter().copied().find(|s| *s != source && app.get_webview_window(&label(*s)).is_some()));
    }
}

/// Browser identity the window reports to websites. `None` = WebView2's own (the same as
/// Microsoft Edge, which all four sources support). If Spotify ever answers "browser not
/// supported", set a current desktop Chrome string here, e.g.
/// "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36".
/// Don't do it without need: Google's sign-in (YouTube Music) is stricter with spoofed browsers.
pub const USER_AGENT: Option<&str> = None;

const INJECT_JS: &str = include_str!("inject.js");

/// The web player's start page for each source.
pub fn source_url(source: BgSource) -> &'static str {
    match source {
        BgSource::Spotify => "https://open.spotify.com",
        BgSource::Ytmusic => "https://music.youtube.com",
        BgSource::Beatport => "https://www.beatport.com",
        // Soundtrack's web player; not verified against a live account yet (M0 spike).
        BgSource::Soundtrack => "https://play.soundtrackyourbrand.com",
        BgSource::Soundcloud => "https://soundcloud.com",
        BgSource::Youtube => "https://www.youtube.com",
    }
}

/// A playlist (or album, station…) link may be opened instead of the start page, but only on the
/// service's own site: the same hosts capabilities/background.json lets report back. Anything else
/// would put a foreign page in a window that can talk to the app.
pub fn link_allowed(source: BgSource, link: &Url) -> bool {
    let Some(host) = link.host_str() else { return false };
    let start = Url::parse(source_url(source)).ok();
    // Short and mobile links end up on the main site (youtu.be → www.youtube.com, m.soundcloud.com…).
    let also = match source {
        BgSource::Soundtrack => host.ends_with(".soundtrack.io"),
        BgSource::Youtube => matches!(host, "youtube.com" | "m.youtube.com" | "youtu.be"),
        BgSource::Soundcloud => matches!(host, "m.soundcloud.com" | "on.soundcloud.com"),
        _ => false,
    };
    link.scheme() == "https" && (start.as_ref().and_then(|u| u.host_str()) == Some(host) || also)
}

/// The ACTIVE source's window.
pub fn get(app: &AppHandle) -> Option<WebviewWindow> {
    active().and_then(|s| app.get_webview_window(&label(s)))
}

/// Makes `source` active, creating its window if needed. An existing window keeps its page (and its
/// music); only a `link` loads something else in it. `show` brings it to the front (Build);
/// otherwise it stays (or is created) hidden (Run).
/// Flags for every WebView2 window (the main one too: windows sharing a browser data folder must
/// agree on them). The first two are what Tauri sets when none are given. The rest keep a hidden or
/// minimised window working at full speed: otherwise Windows' browser engine slows its timers to
/// once a minute after a while, so a schedule started late and Spotify's device list never opened
/// while the app sat minimised in the taskbar.
pub const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion,IntensiveWakeUpThrottling \
--autoplay-policy=no-user-gesture-required \
--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows";

pub fn open(app: &AppHandle, source: BgSource, show: bool, link: Option<Url>) -> Result<(), String> {
    set_active(Some(source));
    let link_given = link.is_some();
    let url = match link {
        Some(l) => l,
        None => Url::parse(source_url(source)).map_err(|e| e.to_string())?,
    };

    if let Some(win) = app.get_webview_window(&label(source)) {
        if link_given {
            win.navigate(url).map_err(|e| e.to_string())?;
        }
        if show {
            let _ = win.show();
            let _ = win.unminimize();
            let _ = win.set_focus();
        }
        return Ok(());
    }

    let mut builder = WebviewWindowBuilder::new(app, label(source), WebviewUrl::External(url))
        // Same account, same engine (see `data_dir`); low spec: the main window's.

        .title("StageGremlin · Background music")
        .inner_size(1100.0, 760.0)
        .min_inner_size(600.0, 400.0)
        .visible(show)
        .initialization_script(INJECT_JS)
        // Must match the main window (tauri.conf.json): windows sharing one browser data folder
        // must agree on this, or WebView2 refuses to create the second one.
        .browser_extensions_enabled(true)
        .additional_browser_args(BROWSER_ARGS);
    // uBlock Origin Lite and any other bundled extension (see extensions.rs).
    if let Some(dir) = app.try_state::<crate::extensions::Extensions>().and_then(|e| e.0.clone()) {
        builder = builder.extensions_path(dir);
    }
    // Same account, same engine; low spec or the installed app's default: the main window's folder.
    if let Some(dir) = data_dir(app, source) {
        builder = builder.data_directory(dir);
    }
    // Owned by the main window: it stays above it (never lost behind it), minimises with it, and
    // can sit exactly on the Background screen's middle area (see `dock`).
    if let Some(main) = app.get_webview_window("main") {
        builder = builder.parent(&main).map_err(|e| e.to_string())?;
    }
    if let Some(ua) = USER_AGENT {
        builder = builder.user_agent(ua);
    }
    let win = builder.build().map_err(|e| e.to_string())?;
    remember_engine_pid(&win, source);

    // X = hide, so a mis-click never stops the music. The main window's close destroys it.
    let for_close = win.clone();
    win.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = for_close.hide();
            if let Some(state) = for_close.app_handle().try_state::<super::BgHandle>() {
                state.set_visible(false);
            }
        }
    });
    if show {
        let _ = win.set_focus();
    }
    Ok(())
}

/// Ask WebView2 which browser process runs this window (the engine); its audio session is found by it.
fn remember_engine_pid(win: &WebviewWindow, source: BgSource) {
    let _ = win.with_webview(move |webview| {
        #[cfg(windows)]
        {
            let mut pid = 0u32;
            // SAFETY: plain WebView2 COM calls on the webview's own thread (with_webview runs there).
            let ok = unsafe { webview.controller().CoreWebView2().and_then(|core| core.BrowserProcessId(&mut pid)) };
            if ok.is_ok() && pid != 0 {
                ENGINE_PID.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(HashMap::new).insert(source, pid);
            }
        }
        #[cfg(not(windows))]
        let _ = (webview, source);
    });
}

/// The Background screen shows the player in its middle area: no frame, placed exactly over that area.
/// `x`, `y` are physical pixels from the main window's top-left content corner; `w`, `h` the size.
pub fn dock(app: &AppHandle, x: i32, y: i32, w: u32, h: u32) -> Result<(), String> {
    let (Some(win), Some(main)) = (get(app), app.get_webview_window("main")) else { return Ok(()) };
    // Only the active one sits in the area; the others go out of sight (and keep playing).
    for other in all(app) {
        if other.label() != win.label() {
            undock_one(&other);
        }
    }
    let origin = main.inner_position().map_err(|e| e.to_string())?;
    let _ = win.set_decorations(false);
    // Without a title bar Windows still draws a shadow and keeps an invisible resize border around
    // the window: both stick out past the area. Off while docked, so it sits exactly in place.
    let _ = win.set_shadow(false);
    let _ = win.set_resizable(false);
    let _ = win.set_skip_taskbar(true);
    let _ = win.set_min_size(None::<tauri::PhysicalSize<u32>>);
    win.set_size(tauri::PhysicalSize::new(w.max(50), h.max(50))).map_err(|e| e.to_string())?;
    win.set_position(tauri::PhysicalPosition::new(origin.x + x, origin.y + y)).map_err(|e| e.to_string())?;
    let _ = win.show();
    Ok(())
}

/// Back to a normal window (frame, taskbar, size), hidden: leaving the Background screen,
/// or while a dialog or menu needs that space.
pub fn undock(app: &AppHandle) {
    for win in all(app) {
        undock_one(&win);
    }
}

fn undock_one(win: &WebviewWindow) {
    let _ = win.hide();
    let _ = win.set_decorations(true);
    let _ = win.set_shadow(true);
    let _ = win.set_resizable(true);
    let _ = win.set_skip_taskbar(false);
    let _ = win.set_min_size(Some(tauri::LogicalSize::new(600.0, 400.0)));
    let _ = win.set_size(tauri::LogicalSize::new(1100.0, 760.0));
    let _ = win.center();
}

/// Out of sight (Run): all player windows. They keep playing.
pub fn hide(app: &AppHandle) {
    for win in all(app) {
        let _ = win.hide();
    }
}

/// Runs a line of JavaScript in one particular service's page (a deck).
pub fn eval_on(app: &AppHandle, source: BgSource, js: &str) -> bool {
    app.get_webview_window(&label(source)).map(|w| w.eval(js).is_ok()).unwrap_or(false)
}

/// Runs a line of JavaScript in the ACTIVE player page (play, pause, next, previous).
pub fn eval(app: &AppHandle, js: &str) -> bool {
    match get(app) {
        Some(win) => win.eval(js).is_ok(),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(source: BgSource, link: &str) -> bool {
        link_allowed(source, &Url::parse(link).unwrap())
    }

    #[test]
    fn playlist_links_only_on_the_services_own_site() {
        assert!(ok(BgSource::Spotify, "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"));
        assert!(ok(BgSource::Soundtrack, "https://play.soundtrackyourbrand.com/playlist/abc"));
        assert!(ok(BgSource::Soundtrack, "https://app.soundtrack.io/music/abc"));
        assert!(ok(BgSource::Soundcloud, "https://soundcloud.com/someone/sets/lunch"));
        assert!(ok(BgSource::Youtube, "https://www.youtube.com/playlist?list=PL123"));
        assert!(ok(BgSource::Youtube, "https://youtu.be/abc"));
        assert!(!ok(BgSource::Youtube, "https://music.youtube.com/playlist?list=x"), "that's YouTube Music");
        assert!(!ok(BgSource::Spotify, "https://music.youtube.com/playlist?list=x"), "another service");
        assert!(!ok(BgSource::Spotify, "http://open.spotify.com/playlist/x"), "not https");
        assert!(!ok(BgSource::Soundtrack, "https://evil.example/soundtrack.io"), "lookalike");
        assert!(!ok(BgSource::Spotify, "https://open.spotify.com.evil.example/x"), "lookalike host");
    }
}
