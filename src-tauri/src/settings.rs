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

    #[test]
    fn old_settings_file_still_loads() {
        let s: MachineSettings = serde_json::from_str(r#"{ "outputDevice": "Qu-24" }"#).unwrap();
        assert_eq!(s.ui, json!({}));
        assert_eq!(s.preview_device, None);
    }
}
