//! Master-bus DSP: a lookahead brickwall limiter that also meters.
//!
//! The limiter is the safety net from the brief: overlapping cues and peak-capped
//! tracks must never clip the desk. It delays the signal by a few milliseconds and
//! looks at what is coming, so the gain is already down when a peak arrives.
//! It also publishes peak levels and gain reduction for the meters, and the
//! short-term loudness (EBU R128, last 3 s) of what leaves the desk output.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use ebur128::{EbuR128, Mode};
use kira::effect::{Effect, EffectBuilder};
use kira::info::Info;
use kira::Frame;

/// Lock-free values the audio thread writes and the UI thread reads.
pub struct MeterShared {
    peak_l: AtomicU32,
    peak_r: AtomicU32,
    /// Largest gain reduction since the last read, as a positive dB value.
    gr_db: AtomicU32,
    /// Peaks that hit the ceiling before limiting since the last read.
    overs: AtomicU32,
    /// Requested ceiling (linear, f32 bits); 0 = unchanged. Lets the show change it live.
    new_ceiling: AtomicU32,
    /// Short-term loudness in LUFS (f32 bits); a level, not a maximum.
    lufs_s: AtomicU32,
}

impl Default for MeterShared {
    fn default() -> Self {
        Self {
            peak_l: AtomicU32::new(0),
            peak_r: AtomicU32::new(0),
            gr_db: AtomicU32::new(0),
            overs: AtomicU32::new(0),
            new_ceiling: AtomicU32::new(0),
            lufs_s: AtomicU32::new(SILENCE_LUFS.to_bits()),
        }
    }
}

/// What the loudness meter shows for silence (R128 says −∞; JSON can't carry that).
pub const SILENCE_LUFS: f32 = -70.0;

impl MeterShared {
    /// Changes the limiter ceiling while audio runs.
    pub fn set_ceiling_db(&self, db: f32) {
        self.new_ceiling.store(10f32.powf(db / 20.0).to_bits(), Ordering::Relaxed);
    }
}

fn store_max(a: &AtomicU32, v: f32) {
    let mut cur = a.load(Ordering::Relaxed);
    while f32::from_bits(cur) < v {
        match a.compare_exchange_weak(cur, v.to_bits(), Ordering::Relaxed, Ordering::Relaxed) {
            Ok(_) => break,
            Err(x) => cur = x,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeterReading {
    /// Output peak, linear 0..1 (after the limiter).
    pub peak_l: f32,
    pub peak_r: f32,
    /// Gain reduction in dB (positive number, 0 = not limiting).
    pub gr_db: f32,
    /// Number of audio blocks where the limiter had to act.
    pub overs: u32,
    /// Short-term loudness of the output (EBU R128, 3 s window), LUFS; −70 = silence.
    #[serde(rename = "lufsS")]
    pub lufs_s: f32,
}

impl MeterShared {
    /// Returns the maxima since the previous call and resets them.
    pub fn take(&self) -> MeterReading {
        MeterReading {
            peak_l: f32::from_bits(self.peak_l.swap(0, Ordering::Relaxed)),
            peak_r: f32::from_bits(self.peak_r.swap(0, Ordering::Relaxed)),
            gr_db: f32::from_bits(self.gr_db.swap(0, Ordering::Relaxed)),
            overs: self.overs.swap(0, Ordering::Relaxed),
            lufs_s: f32::from_bits(self.lufs_s.load(Ordering::Relaxed)),
        }
    }
}

pub struct LimiterBuilder {
    pub ceiling_db: f32,
    pub lookahead_ms: f32,
    pub release_ms: f32,
}

impl Default for LimiterBuilder {
    fn default() -> Self {
        Self { ceiling_db: -1.0, lookahead_ms: 5.0, release_ms: 80.0 }
    }
}

pub struct LimiterHandle {
    pub meter: Arc<MeterShared>,
}

impl EffectBuilder for LimiterBuilder {
    type Handle = LimiterHandle;

    fn build(self) -> (Box<dyn Effect>, Self::Handle) {
        let meter = Arc::new(MeterShared::default());
        let lim = Limiter::new(self, meter.clone());
        (Box::new(lim), LimiterHandle { meter })
    }
}

pub struct Limiter {
    ceiling: f32,
    lookahead_ms: f32,
    release_ms: f32,
    sample_rate: u32,
    delay: VecDeque<Frame>,
    /// Required gain for each frame in the lookahead window, kept as a monotonic
    /// queue so the window minimum is O(1).
    window: VecDeque<(usize, f32)>,
    index: usize,
    lookahead: usize,
    gain: f32,
    attack_coef: f32,
    release_coef: f32,
    meter: Arc<MeterShared>,
    /// Loudness meter. Created in `init` (allocates once), then only fed.
    loudness: Option<EbuR128>,
    /// Reused interleaved L/R buffer for the meter, so `process` never allocates.
    interleaved: Vec<f32>,
    /// Frames since the last short-term reading; we read ~10 times a second
    /// because each reading sums the whole 3 s window.
    since_reading: usize,
}

impl Limiter {
    fn new(b: LimiterBuilder, meter: Arc<MeterShared>) -> Self {
        let mut l = Self {
            ceiling: 10f32.powf(b.ceiling_db / 20.0),
            lookahead_ms: b.lookahead_ms,
            release_ms: b.release_ms,
            sample_rate: 48_000,
            delay: VecDeque::new(),
            window: VecDeque::new(),
            index: 0,
            lookahead: 0,
            gain: 1.0,
            attack_coef: 0.0,
            release_coef: 0.0,
            meter,
            loudness: None,
            interleaved: Vec::new(),
            since_reading: 0,
        };
        l.configure(48_000);
        l
    }

    fn configure(&mut self, sample_rate: u32) {
        self.sample_rate = sample_rate.max(1);
        let sr = self.sample_rate as f32;
        self.lookahead = ((self.lookahead_ms / 1000.0) * sr).round().max(1.0) as usize;
        // Attack settles within the lookahead (about 4 time constants).
        let attack_tau = (self.lookahead as f32 / 4.0).max(1.0);
        self.attack_coef = (-1.0 / attack_tau).exp();
        self.release_coef = (-1.0 / ((self.release_ms / 1000.0) * sr).max(1.0)).exp();
        self.delay.clear();
        self.window.clear();
        self.delay.extend(std::iter::repeat_n(Frame::ZERO, self.lookahead));
        self.gain = 1.0;
    }

    /// Processes one frame; returns the limited, delayed frame.
    #[inline]
    pub fn tick(&mut self, input: Frame) -> Frame {
        let peak = input.left.abs().max(input.right.abs());
        let need = if peak > self.ceiling { self.ceiling / peak } else { 1.0 };

        // Monotonic queue: drop entries that can never be the minimum again.
        while let Some(&(_, g)) = self.window.back() {
            if g >= need {
                self.window.pop_back();
            } else {
                break;
            }
        }
        self.window.push_back((self.index, need));
        while let Some(&(i, _)) = self.window.front() {
            if i + self.lookahead < self.index {
                self.window.pop_front();
            } else {
                break;
            }
        }
        let target = self.window.front().map(|&(_, g)| g).unwrap_or(1.0);

        self.gain = if target < self.gain {
            target + (self.gain - target) * self.attack_coef
        } else {
            target + (self.gain - target) * self.release_coef
        };
        self.index = self.index.wrapping_add(1);

        self.delay.push_back(input);
        let out = self.delay.pop_front().unwrap_or(Frame::ZERO) * self.gain;
        // Hard clamp: the attack curve can leave a sliver of overshoot.
        Frame::new(out.left.clamp(-self.ceiling, self.ceiling), out.right.clamp(-self.ceiling, self.ceiling))
    }

    /// Feeds the output to the loudness meter in chunks that fit the reused buffer.
    fn measure_loudness(&mut self, frames: &[Frame]) {
        let Some(meter) = &mut self.loudness else { return };
        let room = self.interleaved.len() / 2;
        if room == 0 {
            return;
        }
        for chunk in frames.chunks(room) {
            for (i, f) in chunk.iter().enumerate() {
                self.interleaved[2 * i] = f.left;
                self.interleaved[2 * i + 1] = f.right;
            }
            let _ = meter.add_frames_f32(&self.interleaved[..chunk.len() * 2]);
        }
        self.since_reading += frames.len();
        if self.since_reading >= (self.sample_rate / 10) as usize {
            self.since_reading = 0;
            let lufs = meter.loudness_shortterm().unwrap_or(f64::NEG_INFINITY) as f32;
            let lufs = if lufs.is_finite() { lufs.max(SILENCE_LUFS) } else { SILENCE_LUFS };
            self.meter.lufs_s.store(lufs.to_bits(), Ordering::Relaxed);
        }
    }

    pub fn latency_frames(&self) -> usize {
        self.lookahead
    }
}

impl Effect for Limiter {
    fn init(&mut self, sample_rate: u32, internal_buffer_size: usize) {
        self.configure(sample_rate);
        self.interleaved = vec![0.0; internal_buffer_size.max(64) * 2];
        self.loudness = EbuR128::new(2, sample_rate, Mode::S).ok();
    }

    fn on_change_sample_rate(&mut self, sample_rate: u32) {
        self.configure(sample_rate);
        // Rare (output device changed): recreating the meter allocates once.
        self.loudness = EbuR128::new(2, sample_rate, Mode::S).ok();
    }

    fn process(&mut self, input: &mut [Frame], _dt: f64, _info: &Info) {
        let nc = self.meter.new_ceiling.swap(0, Ordering::Relaxed);
        if nc != 0 {
            self.ceiling = f32::from_bits(nc);
        }
        let (mut pl, mut pr, mut min_gain) = (0f32, 0f32, 1f32);
        for f in input.iter_mut() {
            *f = self.tick(*f);
            pl = pl.max(f.left.abs());
            pr = pr.max(f.right.abs());
            min_gain = min_gain.min(self.gain);
        }
        store_max(&self.meter.peak_l, pl);
        store_max(&self.meter.peak_r, pr);
        let gr = -20.0 * min_gain.max(1e-6).log10();
        store_max(&self.meter.gr_db, gr);
        if gr > 0.1 {
            self.meter.overs.fetch_add(1, Ordering::Relaxed);
        }
        self.measure_loudness(input);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limiter_never_exceeds_ceiling() {
        let (meter, ceiling) = (Arc::new(MeterShared::default()), 10f32.powf(-1.0 / 20.0));
        let mut l = Limiter::new(LimiterBuilder::default(), meter);
        l.configure(48_000);
        let mut max_out = 0f32;
        for i in 0..48_000 {
            // Quiet sine with a burst at +6 dBFS in the middle.
            let amp = if (20_000..21_000).contains(&i) { 2.0 } else { 0.3 };
            let s = amp * (i as f32 * 0.05).sin();
            let o = l.tick(Frame::new(s, -s));
            max_out = max_out.max(o.left.abs()).max(o.right.abs());
        }
        assert!(max_out <= ceiling + 1e-6, "peak {max_out} over ceiling {ceiling}");
    }

    #[test]
    fn shortterm_loudness_is_reported() {
        let meter = Arc::new(MeterShared::default());
        assert_eq!(meter.take().lufs_s, SILENCE_LUFS);
        let mut l = Limiter::new(LimiterBuilder::default(), meter.clone());
        l.init(48_000, 128);
        // 1 s of a 1 kHz sine at −20 dBFS: about −23 LUFS on two channels.
        let mut block = vec![Frame::ZERO; 128];
        let mut n = 0usize;
        for _ in 0..375 {
            for f in block.iter_mut() {
                let s = 0.1 * (n as f32 * 2.0 * std::f32::consts::PI * 1000.0 / 48_000.0).sin();
                *f = Frame::new(s, s);
                n += 1;
            }
            l.measure_loudness(&block);
        }
        let lufs = meter.take().lufs_s;
        assert!((-26.0..-20.0).contains(&lufs), "short-term {lufs} LUFS");
    }

    #[test]
    fn limiter_is_transparent_below_ceiling() {
        let mut l = Limiter::new(LimiterBuilder::default(), Arc::new(MeterShared::default()));
        l.configure(48_000);
        let lat = l.latency_frames();
        let input: Vec<f32> = (0..2000).map(|i| 0.5 * (i as f32 * 0.03).sin()).collect();
        let out: Vec<f32> = input.iter().map(|&s| l.tick(Frame::new(s, s)).left).collect();
        for i in lat..2000 {
            assert!((out[i] - input[i - lat]).abs() < 1e-6);
        }
    }
}
