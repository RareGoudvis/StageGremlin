//! Per-machine settings (not part of a show): which audio outputs to use.
//! Stored as `settings.json` in the data folder (next to the .exe in portable mode),
//! so the school laptop remembers "use the Qu-24" between shows.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

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
}

fn default_output() -> Option<String> {
    Some(DEFAULT_OUTPUT.to_string())
}

impl Default for MachineSettings {
    fn default() -> Self {
        Self { output_device: default_output(), preview_device: None }
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

pub fn save(path: &Path, settings: &MachineSettings) -> Result<(), String> {
    let text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| format!("Could not save settings to {}: {e}", path.display()))
}
