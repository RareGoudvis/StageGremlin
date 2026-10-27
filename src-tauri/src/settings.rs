//! Per-machine settings (not part of a show): which audio outputs to use.
//! Stored as `settings.json` in the data folder (next to the .exe in portable mode),
//! so the school laptop remembers "use the Qu-24" between shows.
//! The UI also keeps its own settings here under `ui` (language, shortcuts, theme…).

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// Two commands saving at the same moment must not overwrite each other's change.
static SAVE_LOCK: Mutex<()> = Mutex::new(());

/// The show mixer at school; used until someone picks another output.
pub const DEFAULT_OUTPUT: &str = "Qu-24";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineSettings {
    /// Part of the output device's name to look for, e.g. "Qu-24".
    /// `null` = always use the Windows default output.
    #[serde(default = "default_output")]
    pub output_device: Option<String>,
    /// Same, for headphone preview. `null` = Windows default output.
    #[serde(default)]
    pub preview_device: Option<String>,
    /// Free-form UI settings; the core never looks inside.
    #[serde(default = "empty_object")]
    pub ui: Value,
}

fn empty_object() -> Value {
    Value::Object(Map::new())
}

fn default_output() -> Option<String> {
    Some(DEFAULT_OUTPUT.to_string())
}

impl Default for MachineSettings {
    fn default() -> Self {
        Self { output_device: default_output(), preview_device: None, ui: empty_object() }
    }
}

pub fn path_in(data_dir: &Path) -> PathBuf {
    data_dir.join("settings.json")
}

/// A missing or damaged file just means "use the defaults".
pub fn load(path: &Path) -> MachineSettings {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Load, change, save, as one step (see `SAVE_LOCK`). Returns the saved settings.
pub fn update(data_dir: &Path, change: impl FnOnce(&mut MachineSettings)) -> Result<MachineSettings, String> {
    let _guard = SAVE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let path = path_in(data_dir);
    let mut settings = load(&path);
    change(&mut settings);
    save(&path, &settings)?;
    Ok(settings)
}

/// Shallow merge for `settings_set`: each top-level key in `patch` replaces the
/// stored one; a `null` value removes the key.
pub fn merge_ui(ui: &mut Value, patch: Value) {
    if !ui.is_object() {
        *ui = empty_object();
    }
    let (Some(target), Value::Object(patch)) = (ui.as_object_mut(), patch) else { return };
    for (key, value) in patch {
        if value.is_null() {
            target.remove(&key);
        } else {
            target.insert(key, value);
        }
    }
}

/// A new build in a fresh folder starts without settings.json. Bring the settings of the most
/// recently used StageGremlin over (a portable copy unzipped next to this one, or the installed
/// version), so the AUDAC names, the Streambox, outputs etc. don't have to be set up again.
/// Returns where they came from; `None` when this copy already has settings or there's nothing to bring.
pub fn carry_over(data_dir: &Path, candidates: &[PathBuf]) -> Option<PathBuf> {
    let own = path_in(data_dir);
    if own.exists() {
        return None;
    }
    let newest = candidates
        .iter()
        .filter(|p| **p != own)
        .filter_map(|p| Some((std::fs::metadata(p).ok()?.modified().ok()?, p)))
        // Only real settings files: a damaged one is skipped, not copied.
        .filter(|(_, p)| std::fs::read_to_string(p).ok().and_then(|t| serde_json::from_str::<MachineSettings>(&t).ok()).is_some())
        .max_by_key(|(when, _)| *when)?
        .1
        .clone();
    std::fs::copy(&newest, &own).ok()?;
    Some(newest)
}

/// Settings files of other StageGremlin copies on this computer: portable folders next to this
/// one (`<parent>/<any folder>/data/settings.json`) and the installed version's.
pub fn other_copies(exe_dir: Option<&Path>, installed_data_dir: Option<&Path>) -> Vec<PathBuf> {
    let mut found = Vec::new();
    if let Some(parent) = exe_dir.and_then(Path::parent) {
        if let Ok(entries) = std::fs::read_dir(parent) {
            for e in entries.flatten() {
                let p = e.path().join("data").join("settings.json");
                if p.is_file() {
                    found.push(p);
                }
            }
        }
    }
    if let Some(dir) = installed_data_dir {
        let p = path_in(dir);
        if p.is_file() {
            found.push(p);
        }
    }
    found
}

/// Settings → a file the operator chose (a backup, or to take to another laptop).
pub fn export(data_dir: &Path, dest: &Path) -> Result<(), String> {
    let settings = load(&path_in(data_dir));
    let text = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(dest, text).map_err(|e| format!("Could not write {}: {e}", dest.display()))
}

/// A file made by `export` → this copy's settings (replaces them all).
pub fn import(data_dir: &Path, src: &Path) -> Result<MachineSettings, String> {
    let text = std::fs::read_to_string(src).map_err(|e| format!("Could not read {}: {e}", src.display()))?;
    let settings: MachineSettings = serde_json::from_str(&text).map_err(|_| "That is not a StageGremlin settings file.".to_string())?;
    if !settings.ui.is_object() {
        return Err("That is not a StageGremlin settings file.".into());
    }
    let _guard = SAVE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    save(&path_in(data_dir), &settings)?;
    Ok(settings)
}

fn save(path: &Path, settings: &MachineSettings) -> Result<(), String> {
    let text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| format!("Could not save settings to {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn ui_patch_merges_and_removes() {
        let mut ui = json!({ "language": "nl", "theme": "dark" });
        merge_ui(&mut ui, json!({ "theme": null, "shortcuts": { "go": "Space" } }));
        assert_eq!(ui, json!({ "language": "nl", "shortcuts": { "go": "Space" } }));
    }

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("sg-settings-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn a_fresh_copy_takes_the_newest_settings_and_keeps_its_own() {
        let root = temp("carry");
        let (old, newer, fresh) = (root.join("build13/data"), root.join("build14/data"), root.join("build15/data"));
        for d in [&old, &newer, &fresh] {
            std::fs::create_dir_all(d).unwrap();
        }
        std::fs::write(path_in(&old), r#"{"ui":{"lang":"en"}}"#).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(30));
        std::fs::write(path_in(&newer), r#"{"ui":{"lang":"nl"}}"#).unwrap();
        let exe_dir = root.join("build15");
        let from = carry_over(&fresh, &other_copies(Some(&exe_dir), None)).unwrap();
        assert_eq!(from, path_in(&newer));
        assert_eq!(load(&path_in(&fresh)).ui, json!({ "lang": "nl" }));
        // Second start: it has its own settings now, nothing is copied over them.
        std::fs::write(path_in(&newer), r#"{"ui":{"lang":"en"}}"#).unwrap();
        assert_eq!(carry_over(&fresh, &other_copies(Some(&exe_dir), None)), None);
        assert_eq!(load(&path_in(&fresh)).ui, json!({ "lang": "nl" }));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_damaged_file_is_not_carried_over() {
        let root = temp("damaged");
        let (bad, fresh) = (root.join("a/data"), root.join("b/data"));
        std::fs::create_dir_all(&bad).unwrap();
        std::fs::create_dir_all(&fresh).unwrap();
        std::fs::write(path_in(&bad), "{ not json").unwrap();
        assert_eq!(carry_over(&fresh, &other_copies(Some(&root.join("b")), None)), None);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn export_then_import_round_trips_and_rejects_other_files() {
        let root = temp("export");
        let (a, b) = (root.join("a"), root.join("b"));
        std::fs::create_dir_all(&a).unwrap();
        std::fs::create_dir_all(&b).unwrap();
        std::fs::write(path_in(&a), r#"{"outputDevice":"Qu-24","ui":{"audac":{"host":"10.14.3.210"}}}"#).unwrap();
        let file = root.join("backup.json");
        export(&a, &file).unwrap();
        let got = import(&b, &file).unwrap();
        assert_eq!(got.ui["audac"]["host"], "10.14.3.210");
        assert_eq!(load(&path_in(&b)).output_device.as_deref(), Some("Qu-24"));
        std::fs::write(root.join("song.json"), "[1,2,3]").unwrap();
        assert!(import(&b, &root.join("song.json")).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn old_settings_file_still_loads() {
        let s: MachineSettings = serde_json::from_str(r#"{ "outputDevice": "Qu-24" }"#).unwrap();
        assert_eq!(s.ui, json!({}));
        assert_eq!(s.preview_device, None);
    }
}
