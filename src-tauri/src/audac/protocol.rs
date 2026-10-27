//! The AUDAC MTX48/MTX88 text protocol (from AUDAC's "MTX Commands User Manual").
//!
//! Every message is one line: `#|destination|source|command|argument|checksum|` + CR LF.
//! The MTX's address is always `X001`. The checksum may be replaced by `U` (always accepted).
//! The MTX answers a command with the same command and `+`, then sends an update to every client,
//! e.g. `#|ALL|X001|V02|40|7378|` = "zone 2 is now at −40 dB".
//!
//! Only pure functions here (build a line, read a line), so they can be tested without a device.

/// Our name in the "source" field (max 4 characters, no `|` or `#`).
const SOURCE: &str = "SG";

pub const ZONES: usize = 8;
/// Volume is sent as dB below maximum: 0 = loudest, 70 = quietest.
pub const MIN_VOLUME: u8 = 70;

/// One command line, ready to write to the socket.
pub fn line(command: &str, argument: &str) -> String {
    format!("#|X001|{SOURCE}|{command}|{argument}|U|\r\n")
}

// Zones are numbered 1–8. The manual writes some commands with one digit (SV2, SR1)
// and others with a leading zero (SVU01, SM01); we follow it exactly.

pub fn set_volume(zone: u8, db_below_max: u8) -> String {
    line(&format!("SV{zone}"), &db_below_max.min(MIN_VOLUME).to_string())
}
pub fn volume_up(zone: u8) -> String {
    line(&format!("SVU0{zone}"), "0")
}
pub fn volume_down(zone: u8) -> String {
    line(&format!("SVD0{zone}"), "0")
}
/// `input` 1–8 (see the manual's input list); 0 = no input.
pub fn set_input(zone: u8, input: u8) -> String {
    line(&format!("SR{zone}"), &input.to_string())
}
pub fn set_mute(zone: u8, mute: bool) -> String {
    line(&format!("SM0{zone}"), if mute { "1" } else { "0" })
}
/// How many names the MTX keeps (found in its own web portal, MTX.swf; not in the public manual):
/// N01–N08 = zones 1–8, N09–N14 = inputs 1–6, then two per zone for inputs 7 and 8 (the wall-panel
/// inputs: N15/N16 for zone 1, N17/N18 for zone 2, … N29/N30 for zone 8).
pub const NAMES: usize = 30;
/// Ask for one name (1–30), exactly as the web portal does: `GN1` … `GN30`. Answer: `N01` … `N30`.
pub fn get_name(i: u8) -> String {
    line(&format!("GN{i}"), "0")
}

/// Ask for everything once after connecting (answers: VALL, RALL, MALL).
pub fn get_all() -> [String; 3] {
    [line("GVALL", "0"), line("GRALL", "0"), line("GMALL", "0")]
}

/// What a line from the MTX tells us.
#[derive(Debug, PartialEq)]
pub enum Update {
    Volume(u8, u8),
    Input(u8, u8),
    Mute(u8, bool),
    AllVolumes(Vec<u8>),
    AllInputs(Vec<u8>),
    AllMutes(Vec<bool>),
    /// One zone at once: volume, input, mute.
    Zone(u8, u8, u8, bool),
    /// Name number 1–30 (see NAMES) and its text.
    Name(u8, String),
    /// "Got your command" (`+`), version answers, bass/treble: nothing to show.
    Other,
}

/// Read one line from the MTX. `None` = not a line we understand.
pub fn parse(raw: &str) -> Option<Update> {
    // "#|ALL|X001|V02|40|…": drop the "#|" so the first field is the destination.
    let text = raw.trim().strip_prefix('#')?.trim_start_matches('|');
    // [destination, source, command, argument, checksum, ...]; the manual's examples
    // sometimes have a space before the command, so trim every field.
    let fields: Vec<&str> = text.split('|').map(str::trim).collect();
    let (command, argument) = (*fields.get(2)?, *fields.get(3)?);
    if argument == "+" {
        return Some(Update::Other);
    }
    let list = |arg: &str| -> Option<Vec<u8>> { arg.split('^').map(|v| v.trim().parse().ok()).collect() };
    match command {
        "VALL" => return Some(Update::AllVolumes(list(argument)?)),
        "RALL" => return Some(Update::AllInputs(list(argument)?)),
        "MALL" => return Some(Update::AllMutes(list(argument)?.into_iter().map(|m| m == 1).collect())),
        _ => {}
    }
    // Per-zone updates: one letter + two digits, e.g. V02, R01, M01.
    // "ZI01" (all of one zone) is volume^input^mute^bass^treble.
    if let Some(zone) = command.strip_prefix("ZI").and_then(|z| z.parse::<u8>().ok()) {
        let v = list(argument)?;
        return Some(match (v.first(), v.get(1), v.get(2)) {
            (Some(&vol), Some(&input), Some(&mute)) => Update::Zone(zone, vol, input, mute == 1),
            _ => Update::Other,
        });
    }
    // Names: "N01" … "N30" (or "N1" … "N30": we ask unpadded, like the portal) with the name as
    // argument (may contain spaces).
    if (2..=3).contains(&command.len()) && command.starts_with('N') && command[1..].bytes().all(|b| b.is_ascii_digit()) {
        if let Ok(i) = command[1..].parse::<u8>() {
            return Some(Update::Name(i, argument.to_string()));
        }
    }
    if command.len() == 3 {
        if let Ok(zone) = command[1..].parse::<u8>() {
            let value: u8 = argument.parse().ok()?;
            return Some(match &command[..1] {
                "V" => Update::Volume(zone, value),
                "R" => Update::Input(zone, value),
                "M" => Update::Mute(zone, value == 1),
                _ => Update::Other,
            });
        }
    }
    Some(Update::Other)
}

#[cfg(test)]
mod tests {
    use super::*;

    // The examples below are copied from AUDAC's MTX command manual.

    #[test]
    fn builds_commands_like_the_manual() {
        assert_eq!(set_volume(2, 40), "#|X001|SG|SV2|40|U|\r\n");
        assert_eq!(volume_up(1), "#|X001|SG|SVU01|0|U|\r\n");
        assert_eq!(volume_down(1), "#|X001|SG|SVD01|0|U|\r\n");
        assert_eq!(set_input(1, 3), "#|X001|SG|SR1|3|U|\r\n");
        assert_eq!(set_mute(1, true), "#|X001|SG|SM01|1|U|\r\n");
        assert_eq!(set_volume(1, 99), "#|X001|SG|SV1|70|U|\r\n", "never below the minimum");
    }

    #[test]
    fn reads_updates() {
        assert_eq!(parse("#|ALL|X001|V02|40|7378|\r\n"), Some(Update::Volume(2, 40)));
        assert_eq!(parse("#|ALL|X001|R01|3|3dc5|"), Some(Update::Input(1, 3)));
        assert_eq!(parse("#|ALL|X001|M01|1|32c6|"), Some(Update::Mute(1, true)));
        assert_eq!(parse("#|web|X001|SV2|+|U|"), Some(Update::Other));
        assert_eq!(parse("#|ALL|X001|B01|8|9dc0|"), Some(Update::Other));
    }

    #[test]
    fn reads_all_zone_answers() {
        assert_eq!(parse("#|web|X001|VALL|40^40^20^20^20^20^20^20|U|"), Some(Update::AllVolumes(vec![40, 40, 20, 20, 20, 20, 20, 20])));
        assert_eq!(parse("#|web|X001| RALL|3^1^1^1^1^1^1^1|U|"), Some(Update::AllInputs(vec![3, 1, 1, 1, 1, 1, 1, 1])));
        assert_eq!(parse("#|web|X001| MALL|0^0^0^0^0^0^0^1|U|").map(|u| matches!(u, Update::AllMutes(m) if m[7])), Some(true));
        assert_eq!(parse("#|web|X001| ZI01|20^3^0^07^07|U|"), Some(Update::Zone(1, 20, 3, false)));
    }

    #[test]
    fn reads_names_like_the_web_portal() {
        assert_eq!(get_name(1), "#|X001|SG|GN1|0|U|\r\n");
        assert_eq!(get_name(30), "#|X001|SG|GN30|0|U|\r\n");
        assert_eq!(parse("#|SG|X001|N01|Gym|U|"), Some(Update::Name(1, "Gym".into())));
        assert_eq!(parse("#|SG|X001|N12|CD - USB|U|"), Some(Update::Name(12, "CD - USB".into())));
        assert_eq!(parse("#|SG|X001|N05||U|"), Some(Update::Name(5, String::new())));
        assert_eq!(parse("#|SG|X001|N1|Gym|U|"), Some(Update::Name(1, "Gym".into())), "unpadded answer");
        assert_eq!(parse("#|SG|X001|NGI|x|U|"), Some(Update::Other), "not a name");
    }

    #[test]
    fn ignores_rubbish() {
        assert_eq!(parse("hello"), None);
        assert_eq!(parse("#|ALL|X001|V02|loud|U|"), None);
        assert_eq!(parse("#|web|X001|SV|V1.1|U|"), Some(Update::Other), "firmware version answer");
    }
}
