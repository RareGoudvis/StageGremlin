//! The background player window: a second Tauri window (label `background`) that shows the
//! web player of the chosen source.
//!
//! - It uses the same WebView2 profile as the app, so sign-ins are kept between sessions
//!   (in portable mode that profile lives in `<exe folder>/data/webview`).
//! - Closing it with the X only hides it: the music keeps playing. It really closes when the
//!   main window closes.
//! - `inject.js` is loaded into every page it shows (remote control + now playing).

use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

use super::BgSource;

pub const LABEL: &str = "background";

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

pub fn get(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
}

/// Creates the window if needed, or loads `source` in the existing one when `navigate` is true.
/// `show` brings it to the front (Build); otherwise it stays (or is created) hidden (Run).
/// `link`: a page on that service to open instead of its start page (checked by `link_allowed`).
pub fn open(app: &AppHandle, source: BgSource, navigate: bool, show: bool, link: Option<Url>) -> Result<(), String> {
    let url = match link {
        Some(l) => l,
        None => Url::parse(source_url(source)).map_err(|e| e.to_string())?,
    };

    if let Some(win) = get(app) {
        if navigate {
            win.navigate(url).map_err(|e| e.to_string())?;
        }
        if show {
            let _ = win.show();
            let _ = win.unminimize();
            let _ = win.set_focus();
        }
        return Ok(());
    }

    let mut builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(url))
        .title("StageGremlin · Background music")
        .inner_size(1100.0, 760.0)
        .min_inner_size(600.0, 400.0)
        .visible(show)
        .initialization_script(INJECT_JS)
        // Must match the main window (tauri.conf.json): windows sharing one browser data folder
        // must agree on this, or WebView2 refuses to create the second one.
        .browser_extensions_enabled(true);
    // uBlock Origin Lite and any other bundled extension (see extensions.rs).
    if let Some(dir) = app.try_state::<crate::extensions::Extensions>().and_then(|e| e.0.clone()) {
        builder = builder.extensions_path(dir);
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

/// The Background screen shows the player in its middle area: no frame, placed exactly over that area.
/// `x`, `y` are physical pixels from the main window's top-left content corner; `w`, `h` the size.
pub fn dock(app: &AppHandle, x: i32, y: i32, w: u32, h: u32) -> Result<(), String> {
    let (Some(win), Some(main)) = (get(app), app.get_webview_window("main")) else { return Ok(()) };
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
    if let Some(win) = get(app) {
        let _ = win.hide();
        let _ = win.set_decorations(true);
        let _ = win.set_shadow(true);
        let _ = win.set_resizable(true);
        let _ = win.set_skip_taskbar(false);
        let _ = win.set_min_size(Some(tauri::LogicalSize::new(600.0, 400.0)));
        let _ = win.set_size(tauri::LogicalSize::new(1100.0, 760.0));
        let _ = win.center();
    }
}

pub fn hide(app: &AppHandle) {
    if let Some(win) = get(app) {
        let _ = win.hide();
    }
}

/// Runs a line of JavaScript in the player page (play, pause, next, previous).
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
