//! Test tones for Preflight.
//!
//! - Pink noise at the show's loudness target (−14 LUFS), so the Qu-24 USB gain is
//!   set once and every show starts at the same level.
//! - A sine at −20 dBFS for a plain line check, 1 kHz or any frequency (to balance speakers and rooms).

use std::sync::Arc;

use ebur128::{EbuR128, Mode};
use kira::sound::static_sound::{StaticSoundData, StaticSoundSettings};
use kira::{Decibels, Frame};

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ToneKind {
    /// Pink noise at the loudness target.
    Pink,
    /// Sine at −20 dBFS (1 kHz unless another frequency is asked for).
    Line,
}

const RATE: u32 = 48_000;
const SECONDS: usize = 10;

/// The sine's frequency, kept to what a 10 s loop can hold in whole waves (0.1 Hz steps),
/// so the loop joins without a click; 20 Hz to 20 kHz.
pub fn loop_safe_hz(hz: f32) -> f32 {
    (hz.clamp(20.0, 20_000.0) * SECONDS as f32).round() / SECONDS as f32
}

/// Builds a looping tone. Pink noise is measured and scaled so it reads `target_lufs`;
/// `hz` is the sine's frequency (see `loop_safe_hz`).
pub fn make(kind: ToneKind, target_lufs: f64, hz: f32) -> StaticSoundData {
    let n = RATE as usize * SECONDS;
    let mut frames: Vec<Frame> = match kind {
        ToneKind::Line => {
            let amp = 10f32.powf(-20.0 / 20.0);
            let hz = f64::from(loop_safe_hz(hz));
            (0..n)
                .map(|i| {
                    // f64 for the phase: at high frequencies over 480 000 samples f32 would drift.
                    let s = amp * (i as f64 * 2.0 * std::f64::consts::PI * hz / f64::from(RATE)).sin() as f32;
                    Frame::new(s, s)
                })
                .collect()
        }
        ToneKind::Pink => pink(n),
    };
    if kind == ToneKind::Pink {
        let gain = 10f64.powf((target_lufs - measure(&frames)) / 20.0) as f32;
        for f in &mut frames {
            *f *= gain;
        }
    }
    StaticSoundData {
        sample_rate: RATE,
        frames: Arc::from(frames),
        settings: StaticSoundSettings::new().loop_region(..).volume(Decibels(0.0)),
        slice: None,
    }
}

/// Pink noise (Paul Kellet's filter), independent left and right channels.
fn pink(n: usize) -> Vec<Frame> {
    let mut seed: u64 = 0x2545_F491_4F6C_DD1D;
    let mut white = move || {
        // xorshift: fast, deterministic, good enough for test noise
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        (seed >> 11) as f32 / (1u64 << 53) as f32 * 2.0 - 1.0
    };
    let mut st = [[0f32; 7]; 2];
    (0..n)
        .map(|_| {
            let mut out = [0f32; 2];
            for (c, b) in st.iter_mut().enumerate() {
                let w = white();
                b[0] = 0.99886 * b[0] + w * 0.0555179;
                b[1] = 0.99332 * b[1] + w * 0.0750759;
                b[2] = 0.96900 * b[2] + w * 0.153_852;
                b[3] = 0.86650 * b[3] + w * 0.3104856;
                b[4] = 0.55000 * b[4] + w * 0.5329522;
                b[5] = -0.7616 * b[5] - w * 0.0168980;
                out[c] = (b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + w * 0.5362) * 0.11;
                b[6] = w * 0.115926;
            }
            Frame::new(out[0], out[1])
        })
        .collect()
}

fn measure(frames: &[Frame]) -> f64 {
    let mut e = EbuR128::new(2, RATE, Mode::I).expect("valid ebur128 params");
    let inter: Vec<f32> = frames.iter().flat_map(|f| [f.left, f.right]).collect();
    let _ = e.add_frames_f32(&inter);
    e.loudness_global().unwrap_or(-30.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pink_tone_hits_the_target_and_stays_under_the_ceiling() {
        let d = make(ToneKind::Pink, -14.0, 1000.0);
        let lufs = measure(&d.frames);
        assert!((lufs - -14.0).abs() < 0.2, "lufs {lufs}");
        let peak = d.frames.iter().fold(0f32, |m, f| m.max(f.left.abs()).max(f.right.abs()));
        assert!(peak < 1.0, "peak {peak}");
    }
}
