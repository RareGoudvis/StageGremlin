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
    }
}

pub fn get(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
}

/// Creates the window if needed, or loads `source` in the existing one when `navigate` is true.
/// `show` brings it to the front (Build); otherwise it stays (or is created) hidden (Run).
pub fn open(app: &AppHandle, source: BgSource, navigate: bool, show: bool) -> Result<(), String> {
    let url = Url::parse(source_url(source)).map_err(|e| e.to_string())?;

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
        .title("RG CuePlay · Background music")
        .inner_size(1100.0, 760.0)
        .min_inner_size(600.0, 400.0)
        .visible(show)
        .initialization_script(INJECT_JS);
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
