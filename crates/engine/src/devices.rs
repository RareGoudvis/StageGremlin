//! Output device selection (real audio only, `device` feature).
//!
//! The show device is remembered by name ("Qu-24 USB …"). If it is not there,
//! the engine falls back to the Windows default output, so a show can always play.

use kira::backend::cpal::cpal::traits::{DeviceTrait, HostTrait};
use kira::backend::cpal::{cpal, CpalBackendSettings};

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputDevice {
    pub name: String,
    pub is_default: bool,
}

fn device_name(d: &cpal::Device) -> Option<String> {
    d.description().ok().map(|desc| desc.name().to_string())
}

/// Every output device Windows reports, default first.
pub fn list_outputs() -> Vec<OutputDevice> {
    let host = cpal::default_host();
    let default = host.default_output_device().and_then(|d| device_name(&d));
    let mut out: Vec<OutputDevice> = host
        .output_devices()
        .map(|it| it.filter_map(|d| device_name(&d)).collect::<Vec<_>>())
        .unwrap_or_default()
        .into_iter()
        .map(|name| OutputDevice { is_default: Some(&name) == default.as_ref(), name })
        .collect();
    out.sort_by_key(|d| !d.is_default);
    out
}

/// Backend settings for the device whose name contains `wanted` (case-insensitive).
/// Returns the settings and whether the wanted device was found; with no match,
/// the default device is used.
pub fn settings_for(wanted: Option<&str>) -> (CpalBackendSettings, bool) {
    let Some(wanted) = wanted.filter(|w| !w.trim().is_empty()) else {
        return (CpalBackendSettings::default(), true);
    };
    let host = cpal::default_host();
    let needle = wanted.to_lowercase();
    let found = host.output_devices().ok().and_then(|mut it| {
        it.find(|d| device_name(d).is_some_and(|n| n.to_lowercase().contains(&needle)))
    });
    match found {
        Some(device) => (CpalBackendSettings { device: Some(device), config: None }, true),
        None => (CpalBackendSettings::default(), false),
    }
}
