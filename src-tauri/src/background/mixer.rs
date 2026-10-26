//! The background mixer: one fader per service, two decks, and the crossfade between them.
//!
//! Every service plays in its own browser engine (window.rs), so Windows gives each its own audio
//! session; mod.rs multiplies the overall background gain (level, duck, auto-duck, faded pause) by the
//! fader gain from here, per engine. A fader that "holds" fades to silence (a deck that was crossfaded
//! away, or a faded pause); its own level is kept for when it comes back.
//! Pure logic: no Windows, no windows. The volume thread calls `tick` every 20 ms.

use std::collections::{HashMap, HashSet};
use std::time::Instant;

use super::BgSource;

const SILENCE_DB: f32 = -60.0;

#[derive(Debug, Clone, Copy)]
struct Ramp {
    from: f32,
    to: f32,
    start: Instant,
    secs: f32,
}

#[derive(Debug, Default)]
pub struct Mixer {
    /// Each service's own fader (dB, 0 = full).
    levels: HashMap<BgSource, f32>,
    /// Faded out (crossfaded away, or paused with a fade): heading for silence.
    held: HashSet<BgSource>,
    /// Where each fader is right now (dB), and where it is fading to.
    current: HashMap<BgSource, f32>,
    ramps: HashMap<BgSource, Ramp>,
    /// Pause this page at that moment (end of its fade-out).
    pause_at: Vec<(BgSource, Instant)>,
    /// What is on deck A and deck B.
    pub decks: [Option<BgSource>; 2],
    /// Which deck is on air: 0 = A, 1 = B.
    pub on_air: usize,
}

impl Mixer {
    pub fn level(&self, s: BgSource) -> f32 {
        self.levels.get(&s).copied().unwrap_or(0.0)
    }

    pub fn is_held(&self, s: BgSource) -> bool {
        self.held.contains(&s)
    }

    fn target(&self, s: BgSource) -> f32 {
        if self.held.contains(&s) { SILENCE_DB } else { self.level(s) }
    }

    fn now_db(&self, s: BgSource) -> f32 {
        self.current.get(&s).copied().unwrap_or_else(|| self.target(s))
    }

    /// Start moving `s` from `from` (where it was BEFORE the target changed) to its target over `secs`.
    fn retarget(&mut self, s: BgSource, from: f32, secs: f32, now: Instant) {
        self.current.insert(s, from);
        self.ramps.insert(s, Ramp { from, to: self.target(s), start: now, secs });
    }

    /// The fader itself (a short fade, so a drag never clicks).
    pub fn set_level(&mut self, s: BgSource, db: f32, now: Instant) {
        let from = self.now_db(s);
        self.levels.insert(s, db.clamp(SILENCE_DB, 0.0));
        self.retarget(s, from, 0.3, now);
    }

    /// Fade to silence, then have the page paused.
    pub fn fade_out_then_pause(&mut self, s: BgSource, secs: f32, now: Instant) {
        let from = self.now_db(s);
        self.held.insert(s);
        self.retarget(s, from, secs, now);
        self.pause_at.retain(|(x, _)| *x != s);
        self.pause_at.push((s, now + std::time::Duration::from_secs_f32(secs.max(0.0))));
    }

    /// Back up to its own level (after play, or as the incoming side of a crossfade).
    pub fn fade_in(&mut self, s: BgSource, secs: f32, now: Instant) {
        let from = self.now_db(s);
        self.held.remove(&s);
        self.pause_at.retain(|(x, _)| *x != s);
        self.retarget(s, from, secs, now);
    }

    /// The on-air deck fades out (and pauses), the other fades in and goes on air.
    /// Returns (out, in), or None when a deck is empty.
    pub fn crossfade(&mut self, secs: f32, now: Instant) -> Option<(BgSource, BgSource)> {
        let (out, inn) = (self.decks[self.on_air]?, self.decks[1 - self.on_air]?);
        if out != inn {
            self.fade_out_then_pause(out, secs, now);
        }
        self.fade_in(inn, secs, now);
        self.on_air = 1 - self.on_air;
        Some((out, inn))
    }

    /// One step: move every fade along; returns the pages whose fade-out ended (pause them now).
    pub fn tick(&mut self, now: Instant) -> Vec<BgSource> {
        let mut done = Vec::new();
        for (s, r) in &self.ramps {
            let t = if r.secs <= 0.0 { 1.0 } else { now.duration_since(r.start).as_secs_f32() / r.secs };
            let db = if t >= 1.0 { r.to } else { r.from + (r.to - r.from) * t };
            self.current.insert(*s, db);
            if t >= 1.0 {
                done.push(*s);
            }
        }
        for s in done {
            self.ramps.remove(&s);
        }
        let (due, later): (Vec<_>, Vec<_>) = self.pause_at.drain(..).partition(|(_, at)| now >= *at);
        self.pause_at = later;
        due.into_iter().map(|(s, _)| s).collect()
    }

    /// The fader's gain right now (0.0 – 1.0).
    pub fn gain(&self, s: BgSource) -> f32 {
        let db = self.now_db(s);
        if db <= SILENCE_DB { 0.0 } else { 10f32.powf(db / 20.0).min(1.0) }
    }

    /// Forget a service whose window closed.
    pub fn forget(&mut self, s: BgSource) {
        self.held.remove(&s);
        self.current.remove(&s);
        self.ramps.remove(&s);
        self.pause_at.retain(|(x, _)| *x != s);
        for d in &mut self.decks {
            if *d == Some(s) {
                *d = None;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn crossfade_swaps_the_decks_and_pauses_the_old_one() {
        let mut m = Mixer::default();
        let t0 = Instant::now();
        m.decks = [Some(BgSource::Spotify), Some(BgSource::Soundcloud)];
        m.fade_out_then_pause(BgSource::Soundcloud, 0.0, t0); // B starts cued (silent)
        m.tick(t0);
        assert_eq!(m.gain(BgSource::Soundcloud), 0.0);

        let (out, inn) = m.crossfade(4.0, t0).unwrap();
        assert_eq!((out, inn, m.on_air), (BgSource::Spotify, BgSource::Soundcloud, 1));
        // Halfway: both somewhere in between.
        m.tick(t0 + Duration::from_secs(2));
        let (a, b) = (m.gain(BgSource::Spotify), m.gain(BgSource::Soundcloud));
        assert!(a > 0.0 && a < 1.0 && b > 0.0 && b < 1.0, "{a} {b}");
        // At the end: A silent and due for a pause, B at full level.
        let paused = m.tick(t0 + Duration::from_secs(4));
        assert_eq!(paused, vec![BgSource::Spotify]);
        assert_eq!(m.gain(BgSource::Spotify), 0.0);
        assert!((m.gain(BgSource::Soundcloud) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn fader_level_is_kept_through_a_pause() {
        let mut m = Mixer::default();
        let t0 = Instant::now();
        m.set_level(BgSource::Spotify, -6.0, t0);
        m.fade_out_then_pause(BgSource::Spotify, 1.0, t0);
        m.tick(t0 + Duration::from_secs(1));
        assert_eq!(m.gain(BgSource::Spotify), 0.0);
        m.fade_in(BgSource::Spotify, 0.0, t0 + Duration::from_secs(2));
        m.tick(t0 + Duration::from_secs(2));
        assert!((m.gain(BgSource::Spotify) - 10f32.powf(-6.0 / 20.0)).abs() < 1e-4);
    }
}
