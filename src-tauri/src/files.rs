//! Small file jobs for the UI: export the show as one zip, check which files
//! exist, and show a file in Explorer.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

/// Zips the .cueplay file and its `media/` folder (not `backups/`) into `dest`.
/// Audio is already compressed, so media is stored as is (fast); the show file
/// itself is deflated. Blocking.
pub fn export_zip(show_path: &Path, dest: &Path) -> Result<(), String> {
    let dir = show_path.parent().ok_or("The show has no folder.")?;
    let part = dest.with_extension("zip.part");
    let file = std::fs::File::create(&part).map_err(|e| format!("Cannot write {}: {e}", dest.display()))?;
    let mut zip = ZipWriter::new(file);

    let result = (|| -> Result<(), String> {
        let show_name = show_path.file_name().and_then(|n| n.to_str()).ok_or("Bad show file name.")?;
        let deflate = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        add_file(&mut zip, show_path, show_name, deflate)?;

        let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored).large_file(true);
        let mut media = vec![];
        collect_files(&dir.join("media"), &mut media);
        for path in media {
            if path == dest || path == part {
                continue; // someone chose to save the zip inside media/
            }
            // Names inside a zip always use forward slashes.
            let rel = path.strip_prefix(dir).map_err(|e| e.to_string())?;
            let name = rel.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/");
            add_file(&mut zip, &path, &name, stored)?;
        }
        zip.finish().map_err(|e| e.to_string())?;
        Ok(())
    })();

    match result {
        Ok(()) => std::fs::rename(&part, dest).map_err(|e| format!("Cannot write {}: {e}", dest.display())),
        Err(e) => {
            let _ = std::fs::remove_file(&part);
            Err(e)
        }
    }
}

fn add_file(zip: &mut ZipWriter<std::fs::File>, path: &Path, name: &str, options: SimpleFileOptions) -> Result<(), String> {
    let mut src = std::fs::File::open(path).map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
    zip.start_file(name, options).map_err(|e| e.to_string())?;
    std::io::copy(&mut src, zip).map_err(|e| format!("Cannot add {}: {e}", path.display()))?;
    zip.flush().map_err(|e| e.to_string())
}

/// All files under `dir`, recursively. A missing folder just gives nothing.
fn collect_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_files(&path, out);
        } else {
            out.push(path);
        }
    }
}

/// Opens the file manager with `path` selected (Windows), or its folder (elsewhere).
pub fn show_in_folder(path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    let child = {
        use std::os::windows::process::CommandExt;
        // Explorer wants `/select,"C:\path"` as one raw argument.
        Command::new("explorer").raw_arg(format!("/select,\"{}\"", path.display())).spawn()
    };
    #[cfg(target_os = "macos")]
    let child = Command::new("open").arg("-R").arg(path).spawn();
    #[cfg(not(any(windows, target_os = "macos")))]
    let child = Command::new("xdg-open").arg(path.parent().unwrap_or(path)).spawn();

    let mut child = child.map_err(|e| format!("Cannot open the folder: {e}"))?;
    // Reap it in the background; Explorer's exit code means nothing useful.
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_zip_has_show_and_media_but_no_backups() {
        let dir = std::env::temp_dir().join(format!("cueplay-zip-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("media/sub")).unwrap();
        std::fs::create_dir_all(dir.join("backups")).unwrap();
        std::fs::write(dir.join("show.cueplay"), "{}").unwrap();
        std::fs::write(dir.join("media/a.mp3"), "aaa").unwrap();
        std::fs::write(dir.join("media/sub/b.wav"), "bbb").unwrap();
        std::fs::write(dir.join("backups/old.cueplay"), "{}").unwrap();
        let dest = dir.join("out.zip");
        export_zip(&dir.join("show.cueplay"), &dest).unwrap();

        let mut names: Vec<String> =
            zip::ZipArchive::new(std::fs::File::open(&dest).unwrap()).unwrap().file_names().map(str::to_string).collect();
        names.sort();
        assert_eq!(names, ["media/a.mp3", "media/sub/b.wav", "show.cueplay"]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
