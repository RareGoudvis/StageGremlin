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
