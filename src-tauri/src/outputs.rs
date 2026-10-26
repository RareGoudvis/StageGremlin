//! Small helpers shared by the show engine and the headphone preview:
//! turning "the operator wants a device whose name contains X" into a real name.

use cueplay_engine::devices;

/// Name of the device that `devices::settings_for(preferred)` picked.
/// `found` is the second value `settings_for` returned.
pub fn picked_name(preferred: Option<&str>, found: bool) -> String {
    let outputs = devices::list_outputs();
    // Same matching rule as `devices::settings_for`: name contains the wish.
    let matched = match (preferred, found) {
        (Some(wish), true) => {
            let needle = wish.to_lowercase();
            outputs.iter().find(|d| d.name.to_lowercase().contains(&needle))
        }
        _ => None,
    };
    matched
        .or_else(|| outputs.iter().find(|d| d.is_default))
        .map(|d| d.name.clone())
        .unwrap_or_else(|| "System default".to_string())
}
