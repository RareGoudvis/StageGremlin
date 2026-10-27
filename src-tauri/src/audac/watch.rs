//! Who changed the zone? The MTX reports every change to every connected client, our own and
//! everyone else's (Touch 2, wall panels, its front panel). This keeps what StageGremlin expects
//! each zone to be, so a change we didn't make can be told apart, shown, and (for guarded zones)
//! put back.
//!
//! Pure bookkeeping (no socket, no clock of its own), so it can be tested.

use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use super::protocol::ZONES;

/// How long after our own command its effects are still settling (a volume step's unknown result,
/// or an old value in a report that was already on its way).
pub const OURS_FOR: Duration = Duration::from_millis(2500);
/// How long an old value in a report counts as "already on its way" rather than a new change.
/// Short: the same value set again by someone else after this is caught (and the 10 s poll
/// catches anything that slips through).
pub const STALE_FOR: Duration = Duration::from_millis(800);
/// A politely guarded setting is put back at most this often per minute; after that we stop
/// fighting (someone keeps changing it on purpose) and only report it. "Hold" has no limit.
pub const MAX_RESTORES_PER_MINUTE: usize = 3;

/// How one zone is protected against changes by someone else.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Rule {
    pub zone: u8,
    /// Put back every change (input, volume, mute).
    pub full: bool,
    /// Never louder than this (dB below max; louder = smaller number): a change by someone else
    /// above it is put back to it. Quieter is allowed.
    pub ceiling: Option<u8>,
    /// No limit on putting back ("Hold"; always for the ceiling: hearing safety).
    pub unlimited: bool,
}

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
    /// Someone else changed it. `restore`: the value to send back (protected zone), if any.
    Foreign { from: u8, restore: Option<u8> },
}

#[derive(Default, Clone)]
struct Slot {
    /// What we expect; None until the MTX has told us once.
    expected: Option<u8>,
    /// After our volume step (result unknown): until when ANY new value counts as our own.
    any_until: Option<Instant>,
    /// After we set or put back a value: the value it had before, which may still arrive in a
    /// report that was already on its way; until when that one is ignored.
    stale: Option<(u8, Instant)>,
    /// When we last put it back (for MAX_RESTORES_PER_MINUTE).
    restores: Vec<Instant>,
}

pub struct Watch {
    slots: Vec<[Slot; 3]>,
    rules: [Option<Rule>; ZONES],
}

impl Default for Watch {
    fn default() -> Self {
        Self { slots: vec![Default::default(); ZONES], rules: [None; ZONES] }
    }
}

impl Watch {
    /// After (re)connecting: forget what we expected; the first answers set it again.
    pub fn reset(&mut self) {
        let rules = self.rules;
        *self = Self::default();
        self.rules = rules;
    }

    /// How each zone is protected (zones not listed: changes are only reported).
    /// Returns the zones that are ALREADY louder than their new ceiling, with the level to bring
    /// them down to: a rule that starts while a zone is too loud must act at once, not wait for
    /// the next change (there may never be one).
    pub fn set_rules(&mut self, rules: &[Rule], now: Instant) -> Vec<(u8, u8)> {
        self.rules = [None; ZONES];
        for r in rules {
            if (1..=ZONES as u8).contains(&r.zone) {
                self.rules[r.zone as usize - 1] = Some(*r);
            }
        }
        let mut down = Vec::new();
        for zone in 1..=ZONES as u8 {
            let Some(c) = self.rule(zone).and_then(|r| r.ceiling) else { continue };
            let Some(slot) = self.slot(zone, Field::Volume) else { continue };
            if let Some(v) = slot.expected.filter(|v| *v < c) {
                slot.expected = Some(c);
                slot.stale = Some((v, now + STALE_FOR));
                down.push((zone, c));
            }
        }
        down
    }

    fn rule(&self, zone: u8) -> Option<Rule> {
        if (1..=ZONES as u8).contains(&zone) { self.rules[zone as usize - 1] } else { None }
    }

    /// We sent a command. `value`: what it will become, or None when we can't know (volume step).
    pub fn ours(&mut self, zone: u8, field: Field, value: Option<u8>, now: Instant) {
        let Some(slot) = self.slot(zone, field) else { return };
        match value {
            None => slot.any_until = Some(now + OURS_FOR),
            Some(v) => {
                if let Some(old) = slot.expected {
                    slot.stale = Some((old, now + STALE_FOR));
                }
                slot.expected = Some(v);
            }
        }
    }

    /// The MTX says `zone`'s `field` is now `value`.
    pub fn verdict(&mut self, zone: u8, field: Field, value: u8, now: Instant) -> Verdict {
        let rule = self.rule(zone);
        let Some(slot) = self.slot(zone, field) else { return Verdict::Fine };
        let any_ours = slot.any_until.is_some_and(|t| now < t);
        let stale = slot.stale.is_some_and(|(v, t)| v == value && now < t);
        match slot.expected {
            None => {
                // The first value we hear (after connecting or reconnecting) is accepted as it is,
                // EXCEPT a volume louder than its ceiling: that may have been turned up while we
                // weren't connected, and must come down now (hearing safety).
                if let Some(c) = rule.and_then(|r| r.ceiling).filter(|c| field == Field::Volume && value < *c) {
                    slot.restores.push(now);
                    slot.stale = Some((value, now + STALE_FOR));
                    slot.expected = Some(c);
                    return Verdict::Foreign { from: c, restore: Some(c) };
                }
                slot.expected = Some(value);
                Verdict::Fine
            }
            Some(e) if e == value => Verdict::Fine,
            // A report from just before our command landed: not a change.
            Some(_) if stale => Verdict::Fine,
            Some(_) if any_ours => {
                // Our own volume step, whose result we couldn't predict: the MTX knows best.
                slot.expected = Some(value);
                Verdict::Fine
            }
            Some(e) => {
                slot.restores.retain(|t| now.duration_since(*t) < Duration::from_secs(60));
                let polite_ok = slot.restores.len() < MAX_RESTORES_PER_MINUTE;
                // What to send back, if anything.
                let target = match rule {
                    // Louder than the ceiling: back to what it was when that was within the
                    // ceiling, otherwise to the ceiling itself.
                    Some(r) if field == Field::Volume && r.ceiling.is_some_and(|c| value < c) => {
                        let c = r.ceiling.unwrap_or(e);
                        Some(if e >= c { e } else { c })
                    }
                    Some(r) if r.full && (r.unlimited || polite_ok) => Some(e),
                    _ => None,
                };
                match target {
                    Some(v) => {
                        // Keep expecting the restored value; the caller sends it.
                        slot.restores.push(now);
                        slot.stale = Some((value, now + STALE_FOR));
                        slot.expected = Some(v);
                    }
                    // Not protected (or we stop fighting): their value is the new normal.
                    None => slot.expected = Some(value),
                }
                Verdict::Foreign { from: e, restore: target }
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
        assert_eq!(w.verdict(5, Field::Input, 4, now + Duration::from_secs(10)), Verdict::Foreign { from: 2, restore: None });
        // Their value is the new normal: hearing it again (a poll) says nothing new.
        assert_eq!(w.verdict(5, Field::Input, 4, now + Duration::from_secs(25)), Verdict::Fine);
    }

    #[test]
    fn a_guarded_zone_is_put_back_but_not_forever() {
        let mut w = Watch::default();
        w.set_rules(&[Rule { zone: 5, full: true, ..Default::default() }], t0());
        let now = t0();
        w.verdict(5, Field::Mute, 0, now);
        let mut restores = 0;
        for i in 1..=6 {
            let at = now + Duration::from_secs(5 * i);
            match w.verdict(5, Field::Mute, 1, at) {
                Verdict::Foreign { from: 0, restore: Some(0) } => {
                    restores += 1;
                    // We sent it back and the MTX confirms ours.
                    assert_eq!(w.verdict(5, Field::Mute, 0, at + Duration::from_millis(300)), Verdict::Fine);
                }
                Verdict::Foreign { restore: None, .. } => break,
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
        w.set_rules(&[Rule { zone: 3, full: true, ..Default::default() }], t0());
        let now = t0();
        w.verdict(3, Field::Input, 1, now);
        w.reset();
        assert_eq!(w.verdict(3, Field::Input, 6, now), Verdict::Fine);
        assert_eq!(w.verdict(3, Field::Input, 2, now + Duration::from_secs(5)), Verdict::Foreign { from: 6, restore: Some(6) });
    }

    #[test]
    fn dragging_our_own_slider_is_never_someone_else() {
        let mut w = Watch::default();
        let now = t0();
        w.verdict(6, Field::Volume, 3, now);
        // Slider: 3 → 9 → 13, answers arrive late and out of step.
        for i in 0..3u64 {
            w.ours(6, Field::Volume, None, now + Duration::from_millis(100 * i));
        }
        for (i, v) in [5u8, 9, 11, 13].iter().enumerate() {
            assert_eq!(w.verdict(6, Field::Volume, *v, now + Duration::from_millis(400 + 150 * i as u64)), Verdict::Fine);
        }
        assert_eq!(w.verdict(6, Field::Volume, 13, now + Duration::from_secs(20)), Verdict::Fine, "settled on the last one");
    }

    #[test]
    fn a_zone_turned_up_while_we_were_disconnected_comes_down_on_reconnect() {
        let mut w = Watch::default();
        let now = t0();
        w.set_rules(&[Rule { zone: 4, ceiling: Some(30), unlimited: true, ..Default::default() }], now);
        w.verdict(4, Field::Volume, 30, now);
        // Connection lost; meanwhile Touch 2 turns zone 4 up to -5 dB. We reconnect:
        w.reset();
        assert_eq!(w.verdict(4, Field::Volume, 5, now + Duration::from_secs(60)), Verdict::Foreign { from: 30, restore: Some(30) });
        // The MTX confirms our correction; a late report of the old -5 is not a new fight.
        assert_eq!(w.verdict(4, Field::Volume, 5, now + Duration::from_millis(60_300)), Verdict::Fine);
        assert_eq!(w.verdict(4, Field::Volume, 30, now + Duration::from_millis(60_500)), Verdict::Fine);
        // Quieter than the ceiling on reconnect is simply accepted.
        w.reset();
        assert_eq!(w.verdict(4, Field::Volume, 45, now + Duration::from_secs(120)), Verdict::Fine);
        // Without a ceiling, a first value is never questioned.
        w.reset();
        assert_eq!(w.verdict(2, Field::Volume, 0, now + Duration::from_secs(130)), Verdict::Fine);
    }

    #[test]
    fn a_ceiling_that_starts_while_a_zone_is_already_too_loud_acts_at_once() {
        let mut w = Watch::default();
        let now = t0();
        w.verdict(3, Field::Volume, 6, now); // zone 3 is loud (-6 dB)
        w.verdict(5, Field::Volume, 40, now); // zone 5 is quiet
        let down = w.set_rules(&[
            Rule { zone: 3, ceiling: Some(30), unlimited: true, ..Default::default() },
            Rule { zone: 5, ceiling: Some(30), unlimited: true, ..Default::default() },
        ], now);
        assert_eq!(down, vec![(3, 30)], "only the zone louder than its ceiling");
        assert_eq!(w.verdict(3, Field::Volume, 30, now + Duration::from_millis(200)), Verdict::Fine, "our correction lands");
        assert!(w.set_rules(&[Rule { zone: 3, ceiling: Some(30), ..Default::default() }], now).is_empty(), "nothing to do twice");
    }

    #[test]
    fn hold_never_gives_up() {
        let mut w = Watch::default();
        w.set_rules(&[Rule { zone: 1, full: true, unlimited: true, ..Default::default() }], t0());
        let now = t0();
        w.verdict(1, Field::Input, 3, now);
        for i in 1..=20 {
            let at = now + Duration::from_secs(2 * i);
            assert_eq!(w.verdict(1, Field::Input, 7, at), Verdict::Foreign { from: 3, restore: Some(3) }, "try {i}");
            assert_eq!(w.verdict(1, Field::Input, 3, at + Duration::from_millis(200)), Verdict::Fine);
        }
    }

    #[test]
    fn no_louder_than_the_ceiling_but_quieter_is_fine() {
        let mut w = Watch::default();
        // Scheduled at -30 dB: someone may turn it down, never up past -30.
        w.set_rules(&[Rule { zone: 4, ceiling: Some(30), unlimited: true, ..Default::default() }], t0());
        let now = t0();
        w.verdict(4, Field::Volume, 30, now);
        assert_eq!(w.verdict(4, Field::Volume, 40, now + Duration::from_secs(5)), Verdict::Foreign { from: 30, restore: None }, "quieter: reported, kept");
        assert_eq!(w.verdict(4, Field::Volume, 10, now + Duration::from_secs(10)), Verdict::Foreign { from: 40, restore: Some(40) }, "louder than ceiling: back to where it was");
        w.verdict(4, Field::Volume, 40, now + Duration::from_millis(10_200));
        assert_eq!(w.verdict(4, Field::Volume, 34, now + Duration::from_secs(15)), Verdict::Foreign { from: 40, restore: None }, "louder but within the ceiling: allowed");
        w.verdict(4, Field::Input, 1, now);
        assert_eq!(w.verdict(4, Field::Input, 2, now + Duration::from_secs(20)), Verdict::Foreign { from: 1, restore: None }, "inputs only reported");
    }
}
