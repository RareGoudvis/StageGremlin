//! Who changed the zone? The MTX reports every change to every connected client, our own and
//! everyone else's (Touch 2, wall panels, its front panel). This keeps what StageGremlin expects
//! each zone to be, so a change we didn't make can be told apart, shown, and (for guarded zones)
//! put back.
//!
//! Pure bookkeeping (no socket, no clock of its own), so it can be tested.

use std::time::{Duration, Instant};

use serde::Serialize;

use super::protocol::ZONES;

/// How long after our own command a change of that setting still counts as ours (the MTX's
/// answer, and a volume step whose result we can't predict).
pub const OURS_FOR: Duration = Duration::from_millis(2500);
/// A guarded setting is put back at most this often per minute; after that we stop fighting
/// (someone keeps changing it on purpose) and only report it.
pub const MAX_RESTORES_PER_MINUTE: usize = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Field {
    Volume,
    Input,
    Mute,
}

fn idx(f: Field) -> usize {
    match f {
        Field::Volume => 0,
        Field::Input => 1,
        Field::Mute => 2,
    }
}

/// What `seen` concluded.
#[derive(Debug, Clone, PartialEq)]
pub enum Verdict {
    /// Expected, our own, or the first value we hear: nothing to say.
    Fine,
    /// Someone else changed it. `restore`: put `from` back (guarded zone).
    Foreign { from: u8, restore: bool },
}

#[derive(Default, Clone)]
struct Slot {
    /// What we expect; None until the MTX has told us once.
    expected: Option<u8>,
    /// Until when a change counts as our own.
    ours_until: Option<Instant>,
    /// When we last put it back (for MAX_RESTORES_PER_MINUTE).
    restores: Vec<Instant>,
}

pub struct Watch {
    slots: Vec<[Slot; 3]>,
    guarded: [bool; ZONES],
}

impl Default for Watch {
    fn default() -> Self {
        Self { slots: vec![Default::default(); ZONES], guarded: [false; ZONES] }
    }
}

impl Watch {
    /// After (re)connecting: forget what we expected; the first answers set it again.
    pub fn reset(&mut self) {
        let guarded = self.guarded;
        *self = Self::default();
        self.guarded = guarded;
    }

    /// Zones (1–8) to put back when someone else changes them.
    pub fn set_guarded(&mut self, zones: &[u8]) {
        self.guarded = [false; ZONES];
        for &z in zones {
            if (1..=ZONES as u8).contains(&z) {
                self.guarded[z as usize - 1] = true;
            }
        }
    }

    pub fn is_guarded(&self, zone: u8) -> bool {
        (1..=ZONES as u8).contains(&zone) && self.guarded[zone as usize - 1]
    }

    /// We sent a command. `value`: what it will become, or None when we can't know (volume step).
    pub fn ours(&mut self, zone: u8, field: Field, value: Option<u8>, now: Instant) {
        let Some(slot) = self.slot(zone, field) else { return };
        slot.ours_until = Some(now + OURS_FOR);
        if value.is_some() {
            slot.expected = value;
        }
    }

    /// The MTX says `zone`'s `field` is now `value`.
    pub fn verdict(&mut self, zone: u8, field: Field, value: u8, now: Instant) -> Verdict {
        let guarded = self.is_guarded(zone);
        let Some(slot) = self.slot(zone, field) else { return Verdict::Fine };
        let ours = slot.ours_until.is_some_and(|t| now < t);
        match slot.expected {
            None => {
                slot.expected = Some(value);
                Verdict::Fine
            }
            Some(e) if e == value => Verdict::Fine,
            Some(_) if ours => {
                // Our own command's result (a volume step we couldn't predict, or the MTX
                // rounding what we asked): the MTX knows best.
                slot.expected = Some(value);
                Verdict::Fine
            }
            Some(e) => {
                slot.restores.retain(|t| now.duration_since(*t) < Duration::from_secs(60));
                let restore = guarded && slot.restores.len() < MAX_RESTORES_PER_MINUTE;
                if restore {
                    // Keep expecting ours; the caller sends it again.
                    slot.restores.push(now);
                    slot.ours_until = Some(now + OURS_FOR);
                } else {
                    // Not guarded (or we stop fighting): their value is the new normal.
                    slot.expected = Some(value);
                }
                Verdict::Foreign { from: e, restore }
            }
        }
    }

    fn slot(&mut self, zone: u8, field: Field) -> Option<&mut Slot> {
        if !(1..=ZONES as u8).contains(&zone) {
            return None;
        }
        Some(&mut self.slots[zone as usize - 1][idx(field)])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t0() -> Instant {
        Instant::now()
    }

    #[test]
    fn first_values_and_our_own_changes_are_fine() {
        let mut w = Watch::default();
        let now = t0();
        assert_eq!(w.verdict(1, Field::Input, 3, now), Verdict::Fine, "first answer sets what we expect");
        w.ours(1, Field::Input, Some(4), now);
        assert_eq!(w.verdict(1, Field::Input, 4, now + Duration::from_millis(200)), Verdict::Fine);
        // Long after: still what we set.
        assert_eq!(w.verdict(1, Field::Input, 4, now + Duration::from_secs(30)), Verdict::Fine);
    }

    #[test]
    fn someone_elses_change_is_reported_once_when_not_guarded() {
        let mut w = Watch::default();
        let now = t0();
        w.verdict(5, Field::Input, 2, now);
        assert_eq!(w.verdict(5, Field::Input, 4, now + Duration::from_secs(10)), Verdict::Foreign { from: 2, restore: false });
        // Their value is the new normal: hearing it again (a poll) says nothing new.
        assert_eq!(w.verdict(5, Field::Input, 4, now + Duration::from_secs(25)), Verdict::Fine);
    }

    #[test]
    fn a_guarded_zone_is_put_back_but_not_forever() {
        let mut w = Watch::default();
        w.set_guarded(&[5]);
        let now = t0();
        w.verdict(5, Field::Mute, 0, now);
        let mut restores = 0;
        for i in 1..=6 {
            let at = now + Duration::from_secs(5 * i);
            match w.verdict(5, Field::Mute, 1, at) {
                Verdict::Foreign { from: 0, restore: true } => {
                    restores += 1;
                    // We sent it back and the MTX confirms ours.
                    assert_eq!(w.verdict(5, Field::Mute, 0, at + Duration::from_millis(300)), Verdict::Fine);
                }
                Verdict::Foreign { restore: false, .. } => break,
                v => panic!("unexpected {v:?}"),
            }
        }
        assert_eq!(restores, MAX_RESTORES_PER_MINUTE, "stops fighting after a few tries a minute");
    }

    #[test]
    fn our_volume_step_is_not_mistaken_for_someone_else() {
        let mut w = Watch::default();
        let now = t0();
        w.verdict(2, Field::Volume, 30, now);
        w.ours(2, Field::Volume, None, now + Duration::from_secs(1));
        assert_eq!(w.verdict(2, Field::Volume, 27, now + Duration::from_millis(1300)), Verdict::Fine);
        assert_eq!(w.verdict(2, Field::Volume, 27, now + Duration::from_secs(20)), Verdict::Fine);
    }

    #[test]
    fn reconnecting_starts_fresh_but_keeps_the_guard() {
        let mut w = Watch::default();
        w.set_guarded(&[3]);
        let now = t0();
        w.verdict(3, Field::Input, 1, now);
        w.reset();
        assert_eq!(w.verdict(3, Field::Input, 6, now), Verdict::Fine);
        assert!(w.is_guarded(3));
    }
}
