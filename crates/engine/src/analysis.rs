//! Loudness analysis (EBU R128) and waveform overview, done once on import.
//!
//! Integrated loudness is gated and averaged over the whole track, so a short loud
//! chorus barely moves it and silence is ignored. True peak is what the peak cap
//! in `show::norm_gain` protects against.

use std::fs::File;
use std::path::Path;

use ebur128::{EbuR128, Mode};
use symphonia::core::codecs::CodecParameters;
use symphonia::core::errors::Error as SymError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::TrackType;
use symphonia::core::io::MediaSourceStream;

use crate::show::Loudness;

/// Number of points in the waveform overview sent to the UI.
pub const WAVEFORM_POINTS: usize = 1200;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Analysis {
    pub loudness: Loudness,
    pub sample_rate: u32,
    pub channels: u32,
    /// Peak amplitude (0..1) per slice of the file, `WAVEFORM_POINTS` long.
    pub waveform: Vec<f32>,
}

#[derive(Debug, thiserror::Error)]
pub enum AnalysisError {
    #[error("could not open the file: {0}")]
    Io(#[from] std::io::Error),
    #[error("could not decode the audio: {0}")]
    Decode(String),
    #[error("the file has no audio track")]
    NoAudio,
}

impl From<SymError> for AnalysisError {
    fn from(e: SymError) -> Self {
        AnalysisError::Decode(e.to_string())
    }
}

impl From<ebur128::Error> for AnalysisError {
    fn from(e: ebur128::Error) -> Self {
        AnalysisError::Decode(format!("{e:?}"))
    }
}

/// Decodes the whole file once and measures it.
pub fn analyze(path: &Path) -> Result<Analysis, AnalysisError> {
    let file = File::open(path)?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let mut reader = symphonia::default::get_probe().probe(&hint, mss, Default::default(), Default::default())?;
    let track = reader.default_track(TrackType::Audio).ok_or(AnalysisError::NoAudio)?;
    let params = match track.codec_params.as_ref() {
        Some(CodecParameters::Audio(p)) => p.clone(),
        _ => return Err(AnalysisError::NoAudio),
    };
    let track_id = track.id;
    let mut decoder = symphonia::default::get_codecs().make_audio_decoder(&params, &Default::default())?;

    let mut ebu: Option<EbuR128> = None;
    let mut rate = params.sample_rate.unwrap_or(0);
    let mut channels = 0u32;
    let mut frames_total: u64 = 0;
    let mut buf: Vec<f32> = vec![];
    // Fine-grained peaks (one per BLOCK frames), downsampled at the end.
    const BLOCK: usize = 512;
    let mut fine: Vec<f32> = vec![];
    let mut block_peak = 0f32;
    let mut block_fill = 0usize;

    loop {
        let packet = match reader.next_packet() {
            Ok(Some(p)) => p,
            Ok(None) => break,
            Err(SymError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(e) => return Err(e.into()),
        };
        if packet.track_id != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(b) => b,
            // A damaged packet: skip it like a player would.
            Err(SymError::DecodeError(_)) => continue,
            Err(e) => return Err(e.into()),
        };
        if decoded.frames() == 0 {
            continue;
        }
        if ebu.is_none() {
            channels = decoded.num_planes() as u32;
            if rate == 0 {
                rate = decoded.spec().rate();
            }
            if channels == 0 || rate == 0 {
                return Err(AnalysisError::NoAudio);
            }
            ebu = Some(EbuR128::new(channels, rate, Mode::I | Mode::LRA | Mode::TRUE_PEAK)?);
        }
        buf.clear();
        decoded.copy_to_vec_interleaved::<f32>(&mut buf);
        if let Some(e) = ebu.as_mut() {
            e.add_frames_f32(&buf)?;
        }
        let ch = channels as usize;
        for frame in buf.chunks_exact(ch) {
            let p = frame.iter().fold(0f32, |m, s| m.max(s.abs()));
            block_peak = block_peak.max(p);
            block_fill += 1;
            if block_fill == BLOCK {
                fine.push(block_peak);
                block_peak = 0.0;
                block_fill = 0;
            }
        }
        frames_total += decoded.frames() as u64;
    }
    if block_fill > 0 {
        fine.push(block_peak);
    }

    let ebu = ebu.ok_or(AnalysisError::NoAudio)?;
    let lufs = ebu.loudness_global().unwrap_or(f64::NEG_INFINITY);
    let lra = ebu.loudness_range().unwrap_or(0.0);
    let mut tp = 0f64;
    for c in 0..channels {
        tp = tp.max(ebu.true_peak(c).unwrap_or(0.0));
    }
    let true_peak_db = if tp > 0.0 { 20.0 * tp.log10() } else { f64::NEG_INFINITY };

    Ok(Analysis {
        loudness: Loudness {
            lufs,
            true_peak_db,
            lra,
            duration: frames_total as f64 / rate as f64,
        },
        sample_rate: rate,
        channels,
        waveform: downsample(&fine, WAVEFORM_POINTS),
    })
}

fn downsample(fine: &[f32], n: usize) -> Vec<f32> {
    if fine.is_empty() {
        return vec![0.0; n];
    }
    (0..n)
        .map(|i| {
            let a = i * fine.len() / n;
            let b = ((i + 1) * fine.len() / n).max(a + 1).min(fine.len());
            fine[a.min(fine.len() - 1)..b].iter().fold(0f32, |m, &v| m.max(v))
        })
        .collect()
}
