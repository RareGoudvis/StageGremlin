//! Browser extensions for the background player window: uBlock Origin Lite comes with the release
//! builds (scripts/release.ps1 fetches it). It cleans up the web players' pages (page ads, trackers);
//! it does not touch the players' own audio/video ads.
//!
//! Release builds carry the extension as a resource (`extensions/<name>/manifest.json`); on start we
//! copy it into `<dataDir>/extensions`, like yt-dlp and ffmpeg into `<dataDir>/bin`. The portable zip
//! already has it there. A dev build without it simply has no extensions.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

/// Managed state: the folder whose subfolders are unpacked extensions, or None when there are none.
pub struct Extensions(pub Option<PathBuf>);

impl Extensions {
    pub fn prepare(app: &AppHandle, data_dir: &Path) -> Self {
        let dest = data_dir.join("extensions");
        if let Ok(res) = app.path().resource_dir() {
            seed(&res.join("extensions"), &dest);
        }
        let has_any = std::fs::read_dir(&dest)
            .map(|mut entries| entries.any(|e| e.map(|e| e.path().join("manifest.json").is_file()).unwrap_or(false)))
            .unwrap_or(false);
        Extensions(has_any.then_some(dest))
    }
}

/// Copy every bundled extension whose manifest differs from the one in the data folder
/// (so a new build brings a newer version along).
fn seed(bundled: &Path, dest: &Path) {
    let Ok(entries) = std::fs::read_dir(bundled) else { return };
    for entry in entries.flatten() {
        let from = entry.path();
        let to = dest.join(entry.file_name());
        let manifest = |dir: &Path| std::fs::read(dir.join("manifest.json")).ok();
        if from.is_dir() && manifest(&from).is_some() && manifest(&from) != manifest(&to) {
            let _ = std::fs::remove_dir_all(&to);
            if let Err(e) = copy_dir(&from, &to) {
                eprintln!("[extensions] couldn't copy {}: {e}", from.display());
            }
        }
    }
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}
