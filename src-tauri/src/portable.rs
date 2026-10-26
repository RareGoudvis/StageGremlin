//! Portable mode: the whole app lives on a USB stick or in one folder.
//!
//! If `portable.txt` (or a `data` folder) sits next to the .exe, everything the app
//! writes (settings, WebView2 cache) goes into `<exe folder>/data` instead of the
//! user's AppData. That way the school laptop needs no install and keeps no traces.

use std::path::PathBuf;

/// Returns `<exe folder>/data` when the app runs in portable mode, otherwise `None`.
pub fn portable_data_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let exe_dir = exe.parent()?;
    let data = exe_dir.join("data");
    if exe_dir.join("portable.txt").is_file() || data.is_dir() {
        Some(data)
    } else {
        None
    }
}

/// Points WebView2 (the browser engine that draws the UI on Windows) at our data
/// folder. It reads this environment variable when the window is created, so this
/// must run before the Tauri builder starts.
#[cfg(windows)]
pub fn use_for_webview(data_dir: &std::path::Path) {
    std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", data_dir.join("webview"));
}

/// Other platforms have no WebView2; nothing to do.
#[cfg(not(windows))]
pub fn use_for_webview(_data_dir: &std::path::Path) {}
