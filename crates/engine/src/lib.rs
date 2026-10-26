//! StageGremlin engine: show model, playback, master DSP and loudness analysis.
//! No UI and no Tauri in here, so it can be tested on its own (`cargo test -p cueplay-engine`).

pub mod analysis;
#[cfg(feature = "device")]
pub mod devices;
pub mod dsp;
pub mod player;
pub mod show;
pub mod tone;

pub use kira;
pub use player::{Engine, EngineState, GoResult};
pub use show::Show;
