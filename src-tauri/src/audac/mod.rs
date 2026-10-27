//! AUDAC MTX88 remote: the school's zone matrix (study hall, corridors…), controlled from the laptop
//! so the operator doesn't need the Touch 2 app on a phone. Not connected to cues: it's a remote.
//!
//! Being connected does NOT lock others out: the manual says the MTX sends every change "to every
//! client", and Touch 2, wall panels and the front panel keep working. We see their changes because
//! the MTX reports them. If the connection is refused we keep retrying every few seconds.
//!
//! One thread ("audac") owns the socket. The UI sends commands through a channel and gets
//! `audac://state` whenever something changes. Nothing here touches the audio engine.
//! Protocol details: protocol.rs.

mod protocol;
mod watch;

use std::collections::VecDeque;
use std::io::{ErrorKind, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use protocol::{Update, MIN_VOLUME, NAMES, ZONES};
use watch::{Field, Rule, Verdict, Watch};

const RETRY_EVERY: Duration = Duration::from_secs(3);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
/// Ask for the state now and then: keeps the link alive and notices a dead one.
/// (Also catches changes by someone else if the MTX didn't announce them.)
const POLL_EVERY: Duration = Duration::from_secs(10);
/// No answer for this long after a poll = the link is gone (cable out, box off).
const DEAD_AFTER: Duration = Duration::from_secs(40);
/// Gap between two lines we send: the MTX may drop a command that arrives right on top of another.
/// (A group of 8 zones then takes ~1 s; fine for a remote.)
const SEND_GAP: Duration = Duration::from_millis(120);
/// How many changes by someone else the panel keeps listing.
const KEEP_CHANGES: usize = 12;
/// Until the MTX has answered all three "everything" questions, ask the missing ones again this often.
const REASK_EVERY: Duration = Duration::from_secs(3);

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    /// Not asked to connect.
    Off,
    Connecting,
    Connected,
    /// Asked to connect, but the MTX can't be reached or someone else holds the connection.
    Retrying,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Zone {
    /// dB below maximum: 0 = loudest, 70 = quietest.
    pub volume: u8,
    /// 1–8 (see the MTX input list), 0 = none.
    pub input: u8,
    pub mute: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudacState {
    pub status: Status,
    pub host: String,
    pub port: u16,
    /// Why we're retrying, in plain words.
    pub message: Option<String>,
    /// False until the MTX has told us its zones once.
    pub known: bool,
    pub zones: Vec<Zone>,
    /// The names stored on the MTX (see protocol::NAMES); empty until it has told us.
    pub names: Vec<String>,
    /// Recent changes made by someone else (Touch 2, a wall panel…), newest last.
    pub changes: Vec<Change>,
    /// How many of the 30 name questions the MTX answered since connecting (0 = it doesn't know GN).
    pub names_answered: u8,
    /// Other apps the MTX answered in the last OTHERS_FOR (by name tag; Touch 2 is "web").
    pub others: Vec<String>,
}

/// A zone setting changed by someone other than StageGremlin.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    /// Counts up, so the UI can tell new ones apart.
    pub id: u64,
    /// Milliseconds since 1970 (the UI shows the time).
    pub at: u64,
    pub zone: u8,
    pub what: Field,
    pub from: u8,
    pub to: u8,
    /// True when StageGremlin put it back (guarded zone).
    pub restored: bool,
}

enum Msg {
    Connect { host: String, port: u16 },
    Disconnect,
    Volume { zone: u8, db: u8 },
    Step { zone: u8, up: bool },
    Input { zone: u8, input: u8 },
    Mute { zone: u8, mute: bool },
    /// How each zone is protected against changes by someone else (empty = report only).
    Guard(Vec<Rule>),
}

/// Managed by Tauri; the commands below talk to the thread through it.
pub struct Audac {
    tx: Mutex<Sender<Msg>>,
    state: Arc<Mutex<AudacState>>,
    talk: Talk,
}

/// The last lines sent to and heard from the MTX, for Settings › AUDAC › "Conversation".
type Talk = Arc<Mutex<TalkLog>>;
/// An app counts as "on the MTX now" this long after the MTX last answered it (Touch 2's
/// level meters arrive several times a second while it's open).
const OTHERS_FOR: Duration = Duration::from_secs(15);
/// Our own name tag in lines to the MTX (protocol.rs, SOURCE).
const SOURCE_NAME: &str = "SG";
const TALK_LINES: usize = 200;

#[derive(Default)]
struct TalkLog {
    lines: VecDeque<String>,
    /// Other apps the MTX also answers (it sends every reply to everyone): their name tag
    /// (e.g. "web") → when last seen and how many lines.
    others: std::collections::BTreeMap<String, (Instant, u64)>,
    /// Level-meter lines ("VU", many a second): counted, not logged, or they'd push out the rest.
    vu: u64,
}

/// For Settings › AUDAC › "Conversation with the MTX".
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TalkReport {
    lines: Vec<String>,
    others: Vec<OtherApp>,
    vu_lines: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OtherApp {
    name: String,
    /// Milliseconds since the MTX last sent something meant for it.
    ago_ms: u64,
    lines: u64,
}

/// "#|web|X001|VU|…" → ("web", "VU"): who a line from the MTX is meant for, and its command.
fn addressee(line: &str) -> Option<(String, String)> {
    let mut f = line.trim_matches(|c: char| c.is_whitespace() || c == '\0').strip_prefix('#')?.trim_start_matches('|').split('|').map(str::trim);
    let to = f.next()?.to_string();
    let _from = f.next()?;
    Some((to, f.next()?.to_string()))
}

fn note_talk(talk: &Talk, arrow: &str, line: &str) {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    // UTC time of day; the UI only needs the order and roughly when.
    let (h, m, sec, ms) = ((now / 3_600_000) % 24, (now / 60_000) % 60, (now / 1000) % 60, now % 1000);
    let mut t = talk.lock().unwrap_or_else(|e| e.into_inner());
    if arrow == "←" {
        if let Some((to, command)) = addressee(line) {
            if to != SOURCE_NAME && to != "ALL" {
                let e = t.others.entry(to).or_insert((Instant::now(), 0));
                *e = (Instant::now(), e.1 + 1);
            }
            if command == "VU" {
                t.vu += 1;
                return;
            }
        }
    }
    let t = &mut *t;
    t.lines.push_back(format!("{h:02}:{m:02}:{sec:02}.{ms:03} UTC {arrow} {}", visible(line.trim_end_matches(['\r', '\n']))));
    while t.lines.len() > TALK_LINES {
        t.lines.pop_front();
    }
}

/// Invisible characters as codes, so the log shows exactly what the MTX sent: a NUL byte as
/// `<00>`, a stray CR as `<0D>`, a byte that isn't text as `<?>`.
fn visible(text: &str) -> String {
    text.chars()
        .map(|c| match c {
            '\u{FFFD}' => "<?>".to_string(),
            c if c.is_control() => format!("<{:02X}>", c as u32),
            c => c.to_string(),
        })
        .collect()
}

pub fn start(app: AppHandle) -> Audac {
    let state = Arc::new(Mutex::new(AudacState {
        status: Status::Off,
        host: String::new(),
        port: 5001,
        message: None,
        known: false,
        zones: vec![Zone { volume: MIN_VOLUME, input: 0, mute: false }; ZONES],
        names: vec![String::new(); NAMES],
        changes: Vec::new(),
        names_answered: 0,
        others: Vec::new(),
    }));
    let talk: Talk = Default::default();
    let talk_for_link = talk.clone();
    let (tx, rx) = mpsc::channel();
    let shared = state.clone();
    std::thread::Builder::new()
        .name("audac".into())
        .spawn(move || Link { app, state: shared, rx, stream: None, buf: Vec::new(), heard: false, got: [false; 3], got_names: [false; NAMES],
            watch: Watch::default(), out: Default::default(), next_change: 1, talk: talk_for_link }.run())
        .expect("could not start the AUDAC thread");
    Audac { tx: Mutex::new(tx), state, talk }
}

struct Link {
    app: AppHandle,
    state: Arc<Mutex<AudacState>>,
    rx: Receiver<Msg>,
    stream: Option<TcpStream>,
    /// Bytes received but not yet a full line.
    buf: Vec<u8>,
    /// Set when a line from the MTX arrived (the link is alive).
    heard: bool,
    /// Answers received since connecting: [volumes, inputs, mutes] of all zones.
    got: [bool; 3],
    /// Which of the MTX's names have arrived since connecting.
    got_names: [bool; NAMES],
    /// What we expect each zone to be (to spot changes by someone else).
    watch: Watch,
    /// Commands waiting to go out, one every SEND_GAP (before any questions).
    out: VecDeque<String>,
    next_change: u64,
    talk: Talk,
}

impl Link {
    fn run(mut self) {
        let mut target: Option<(String, u16)> = None;
        let mut next_try = Instant::now();
        let mut last_poll = Instant::now();
        let mut last_heard = Instant::now();
        let mut last_others = Instant::now();
        // Questions waiting to go out, one every ASK_GAP (see get_all).
        let mut asks: VecDeque<String> = Default::default();
        let mut next_ask = Instant::now();
        let mut last_reask = Instant::now();
        // Names are asked again at most this many times (older firmware may not know GN).
        let mut name_rounds = 0;
        // A slider sends many volumes; only the newest per zone goes out (see `flush`).
        let mut pending_volume: [Option<u8>; ZONES] = [None; ZONES];

        loop {
            // 1. Messages from the UI. Wait longer when there's nothing to read.
            let wait = if self.stream.is_some() { Duration::from_millis(20) } else { Duration::from_millis(250) };
            let first = match self.rx.recv_timeout(wait) {
                Ok(m) => Some(m),
                Err(RecvTimeoutError::Timeout) => None,
                Err(RecvTimeoutError::Disconnected) => return, // app is closing
            };
            let mut msgs: Vec<Msg> = first.into_iter().collect();
            msgs.extend(self.rx.try_iter());
            for msg in msgs {
                match msg {
                    Msg::Connect { host, port } => {
                        self.drop_link();
                        target = Some((host.clone(), port));
                        next_try = Instant::now();
                        self.update(|s| {
                            s.host = host;
                            s.port = port;
                            s.status = Status::Connecting;
                            s.message = None;
                        });
                    }
                    Msg::Disconnect => {
                        target = None;
                        self.drop_link();
                        self.update(|s| {
                            s.status = Status::Off;
                            s.message = None;
                            s.known = false;
                            // Not connected: we can't see who else is.
                            s.others.clear();
                        });
                    }
                    Msg::Volume { zone, db } => {
                        pending_volume[zone as usize - 1] = Some(db);
                        // A slider sends a run of volumes; the MTX answers each, some after the next one
                        // went out. So for a moment ANY volume report for this zone is ours.
                        self.watch.ours(zone, Field::Volume, None, Instant::now());
                        // Show it right away; the MTX's own update confirms it a moment later.
                        self.update(|s| s.zones[zone as usize - 1].volume = db);
                    }
                    Msg::Step { zone, up } => {
                        self.watch.ours(zone, Field::Volume, None, Instant::now());
                        self.out.push_back(if up { protocol::volume_up(zone) } else { protocol::volume_down(zone) });
                    }
                    Msg::Input { zone, input } => {
                        self.watch.ours(zone, Field::Input, Some(input), Instant::now());
                        self.out.push_back(protocol::set_input(zone, input));
                        self.update(|s| s.zones[zone as usize - 1].input = input);
                    }
                    Msg::Mute { zone, mute } => {
                        self.watch.ours(zone, Field::Mute, Some(mute as u8), Instant::now());
                        self.out.push_back(protocol::set_mute(zone, mute));
                        self.update(|s| s.zones[zone as usize - 1].mute = mute);
                    }
                    Msg::Guard(rules) => self.watch.set_rules(&rules),
                }
            }

            // 2. Connect (again) when asked to and not connected.
            if let (None, Some((host, port))) = (&self.stream, &target) {
                if Instant::now() >= next_try {
                    next_try = Instant::now() + RETRY_EVERY;
                    match connect(host, *port) {
                        Ok(stream) => {
                            self.stream = Some(stream);
                            self.buf.clear();
                            last_poll = Instant::now();
                            last_heard = Instant::now();
                            self.got = [false; 3];
                            self.got_names = [false; NAMES];
                            self.watch.reset();
                            self.out.clear();
                            pending_volume = [None; ZONES];
                            name_rounds = 0;
                            asks = protocol::get_all().into_iter().collect();
                            asks.extend((1..=NAMES as u8).map(protocol::get_name));
                            next_ask = Instant::now();
                            last_reask = Instant::now();
                            self.update(|s| {
                                s.status = Status::Connected;
                                s.message = None;
                            });
                            eprintln!("[audac] connected to {host}:{port}");
                        }
                        Err(why) => self.update(|s| {
                            s.status = Status::Retrying;
                            s.message = Some(why);
                        }),
                    }
                }
            }

            // 3. Read what the MTX says, and check the link is still alive.
            if self.stream.is_some() {
                self.read();
                // Ask the questions one at a time; re-ask what's still unanswered.
                let names_missing = name_rounds < 3 && self.got_names.contains(&false);
                if (self.got != [true; 3] || names_missing) && asks.is_empty() && last_reask.elapsed() >= REASK_EVERY {
                    last_reask = Instant::now();
                    let all = protocol::get_all();
                    asks = (0..3).filter(|&i| !self.got[i]).map(|i| all[i].clone()).collect();
                    if names_missing {
                        name_rounds += 1;
                        asks.extend((0..NAMES).filter(|&i| !self.got_names[i]).map(|i| protocol::get_name(i as u8 + 1)));
                    }
                }
                // One line per SEND_GAP: newest slider volumes first, then commands, then questions.
                if Instant::now() >= next_ask {
                    let volume = pending_volume.iter_mut().enumerate().find_map(|(i, v)| v.take().map(|db| protocol::set_volume(i as u8 + 1, db)));
                    if let Some(l) = volume.or_else(|| self.out.pop_front()).or_else(|| asks.pop_front()) {
                        self.send(&l);
                        next_ask = Instant::now() + SEND_GAP;
                    }
                }
                if last_poll.elapsed() >= POLL_EVERY {
                    last_poll = Instant::now();
                    asks.extend(protocol::get_all());
                }
                // Who else is on the MTX right now (Touch 2 streams level meters while open).
                if last_others.elapsed() >= Duration::from_secs(1) {
                    last_others = Instant::now();
                    let now_others = self.others_now();
                    let changed = self.state.lock().map(|s| s.others != now_others).unwrap_or(false);
                    if changed {
                        self.update(|s| s.others = now_others);
                    }
                }
                if self.heard_something() {
                    last_heard = Instant::now();
                } else if last_heard.elapsed() >= DEAD_AFTER {
                    self.lost("The MTX stopped answering.");
                }
            }
        }
    }

    /// Read whatever arrived and apply every full line.
    fn read(&mut self) {
        let Some(stream) = self.stream.as_mut() else { return };
        let mut chunk = [0u8; 1024];
        match stream.read(&mut chunk) {
            Ok(0) => self.lost("The MTX closed the connection (is someone else connected?)."),
            Ok(n) => {
                // The MTX puts a NUL byte before every line (seen on the real box): drop them, or
                // no line would start with '#' and nothing would be understood.
                self.buf.extend(chunk[..n].iter().copied().filter(|&b| b != 0));
                // The manual ends lines with "return": that may be CR only, CR LF, or LF. Accept all.
                while let Some(end) = self.buf.iter().position(|&b| b == b'\n' || b == b'\r') {
                    let raw: Vec<u8> = self.buf.drain(..=end).collect();
                    let text = String::from_utf8_lossy(&raw);
                    // Log everything except the bare line breaks between messages.
                    if text.trim_matches(['\r', '\n']).is_empty() {
                        continue;
                    }
                    note_talk(&self.talk, "←", &text);
                    if text.trim().is_empty() {
                        continue;
                    }
                    if let Some(u) = protocol::parse(&text) {
                        self.apply(u);
                    }
                }
            }
            Err(e) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(e) => self.lost(&format!("Connection lost: {e}")),
        }
    }

    /// True once per batch of received data (set by `apply`).
    fn heard_something(&mut self) -> bool {
        std::mem::take(&mut self.heard)
    }

    fn apply(&mut self, u: Update) {
        self.heard = true;
        let zone = |z: u8| (1..=ZONES as u8).contains(&z).then(|| z as usize - 1);
        match u {
            Update::AllVolumes(_) => self.got[0] = true,
            Update::AllInputs(_) => self.got[1] = true,
            Update::AllMutes(_) => self.got[2] = true,
            Update::Name(i, _) if (1..=NAMES as u8).contains(&i) => self.got_names[i as usize - 1] = true,
            _ => {}
        }
        // Who made this change? (Our own, expected, or someone else's.)
        let now = Instant::now();
        let mut seen: Vec<(u8, Field, u8)> = Vec::new();
        let each = |list: &[u8], f: Field, out: &mut Vec<(u8, Field, u8)>| {
            list.iter().enumerate().take(ZONES).for_each(|(i, v)| out.push((i as u8 + 1, f, *v)));
        };
        match &u {
            Update::Volume(z, v) => seen.push((*z, Field::Volume, *v)),
            Update::Input(z, v) => seen.push((*z, Field::Input, *v)),
            Update::Mute(z, m) => seen.push((*z, Field::Mute, *m as u8)),
            Update::Zone(z, v, i, m) => seen.extend([(*z, Field::Volume, *v), (*z, Field::Input, *i), (*z, Field::Mute, *m as u8)]),
            Update::AllVolumes(v) => each(v, Field::Volume, &mut seen),
            Update::AllInputs(v) => each(v, Field::Input, &mut seen),
            Update::AllMutes(v) => each(&v.iter().map(|m| *m as u8).collect::<Vec<_>>(), Field::Mute, &mut seen),
            _ => {}
        }
        let mut changes = Vec::new();
        for (zone, what, to) in seen {
            if let Verdict::Foreign { from, restore } = self.watch.verdict(zone, what, to, now) {
                if let Some(v) = restore {
                    // Ahead of everything else waiting: a too-loud zone must come down at once.
                    self.out.push_front(match what {
                        Field::Volume => protocol::set_volume(zone, v),
                        Field::Input => protocol::set_input(zone, v),
                        Field::Mute => protocol::set_mute(zone, v == 1),
                    });
                }
                let restore = restore.is_some();
                eprintln!("[audac] zone {zone} {what:?} changed by someone else: {from} -> {to}{}", if restore { " (put back)" } else { "" });
                let at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
                changes.push(Change { id: self.next_change, at, zone, what, from, to, restored: restore });
                self.next_change += 1;
            }
        }
        // The panel opens as soon as we know the volumes: inputs and mutes follow (re-asked if dropped).
        let known = self.got[0];
        let answered = self.got_names.iter().filter(|g| **g).count() as u8;
        self.update(|s| {
            if known {
                s.known = true;
            }
            s.names_answered = answered;
            if !changes.is_empty() {
                s.changes.extend(changes);
                let extra = s.changes.len().saturating_sub(KEEP_CHANGES);
                s.changes.drain(..extra);
            }
            match u {
                Update::Volume(z, v) => { if let Some(i) = zone(z) { s.zones[i].volume = v } }
                Update::Input(z, v) => { if let Some(i) = zone(z) { s.zones[i].input = v } }
                Update::Mute(z, m) => { if let Some(i) = zone(z) { s.zones[i].mute = m } }
                Update::Zone(z, v, input, m) => {
                    if let Some(i) = zone(z) {
                        s.zones[i] = Zone { volume: v, input, mute: m };
                    }
                }
                Update::AllVolumes(v) => v.iter().zip(s.zones.iter_mut()).for_each(|(v, z)| z.volume = *v),
                Update::AllInputs(v) => v.iter().zip(s.zones.iter_mut()).for_each(|(v, z)| z.input = *v),
                Update::AllMutes(v) => {
                    v.iter().zip(s.zones.iter_mut()).for_each(|(v, z)| z.mute = *v);
                }
                Update::Name(i, name) => {
                    if (1..=NAMES as u8).contains(&i) {
                        s.names[i as usize - 1] = name;
                    }
                }
                Update::Other => {}
            }
        });
    }

    /// Name tags of other apps the MTX answered in the last OTHERS_FOR.
    fn others_now(&self) -> Vec<String> {
        let t = self.talk.lock().unwrap_or_else(|e| e.into_inner());
        t.others.iter().filter(|(_, (at, _))| at.elapsed() < OTHERS_FOR).map(|(name, _)| name.clone()).collect()
    }

    fn send(&mut self, line: &str) {
        let Some(stream) = self.stream.as_mut() else { return };
        note_talk(&self.talk, "→", line);
        if let Err(e) = stream.write_all(line.as_bytes()) {
            self.lost(&format!("Couldn't send: {e}"));
        }
    }

    fn lost(&mut self, why: &str) {
        eprintln!("[audac] {why}");
        self.drop_link();
        let why = why.to_string();
        self.update(|s| {
            s.status = Status::Retrying;
            s.message = Some(why);
        });
    }

    fn drop_link(&mut self) {
        if let Some(s) = self.stream.take() {
            let _ = s.shutdown(std::net::Shutdown::Both);
        }
        self.buf.clear();
    }

    /// Change the shared state and tell the UI.
    fn update(&self, change: impl FnOnce(&mut AudacState)) {
        let snapshot = {
            let mut s = self.state.lock().unwrap_or_else(|e| e.into_inner());
            change(&mut s);
            s.clone()
        };
        let _ = self.app.emit("audac://state", snapshot);
    }
}

fn connect(host: &str, port: u16) -> Result<TcpStream, String> {
    let addr = (host, port)
        .to_socket_addrs()
        .map_err(|_| format!("Can't find {host} on the network."))?
        .next()
        .ok_or_else(|| format!("Can't find {host} on the network."))?;
    let stream = TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT)
        .map_err(|_| format!("No answer from {host}:{port}. Is the MTX on, on this network, and nobody else connected (Touch 2)?"))?;
    // Short read timeout: the thread also has to look at the UI's messages.
    stream.set_read_timeout(Some(Duration::from_millis(30))).map_err(|e| e.to_string())?;
    stream.set_write_timeout(Some(Duration::from_secs(2))).map_err(|e| e.to_string())?;
    let _ = stream.set_nodelay(true);
    Ok(stream)
}

// ---------------------------------------------------------------------------------------------
// Commands (contract: docs/ipc.md, "AUDAC")
// ---------------------------------------------------------------------------------------------

fn zone_ok(zone: u8) -> Result<(), String> {
    if (1..=ZONES as u8).contains(&zone) { Ok(()) } else { Err(format!("Zone {zone} doesn't exist (1–{ZONES}).")) }
}

fn post(a: &Audac, msg: Msg) -> Result<(), String> {
    a.tx.lock().unwrap_or_else(|e| e.into_inner()).send(msg).map_err(|_| "The AUDAC link has stopped.".to_string())
}

/// Connect and keep the connection (retrying) until `audac_disconnect`.
#[tauri::command]
pub fn audac_connect(audac: State<'_, Audac>, host: String, port: Option<u16>) -> Result<(), String> {
    let host = host.trim().to_string();
    if host.is_empty() {
        return Err("Fill in the MTX's IP address first.".into());
    }
    post(&audac, Msg::Connect { host, port: port.unwrap_or(5001) })
}

/// Let go of the MTX, so the Touch 2 app can connect again.
#[tauri::command]
pub fn audac_disconnect(audac: State<'_, Audac>) -> Result<(), String> {
    post(&audac, Msg::Disconnect)
}

#[tauri::command]
pub fn audac_get_state(audac: State<'_, Audac>) -> AudacState {
    audac.state.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

/// `db` = dB below maximum (0 loudest … 70 quietest).
#[tauri::command]
pub fn audac_set_volume(audac: State<'_, Audac>, zone: u8, db: u8) -> Result<(), String> {
    zone_ok(zone)?;
    post(&audac, Msg::Volume { zone, db: db.min(MIN_VOLUME) })
}

/// ±3 dB (the MTX's own step).
#[tauri::command]
pub fn audac_step_volume(audac: State<'_, Audac>, zone: u8, up: bool) -> Result<(), String> {
    zone_ok(zone)?;
    post(&audac, Msg::Step { zone, up })
}

#[tauri::command]
pub fn audac_set_input(audac: State<'_, Audac>, zone: u8, input: u8) -> Result<(), String> {
    zone_ok(zone)?;
    if input > 8 {
        return Err(format!("Input {input} doesn't exist (1–8)."));
    }
    post(&audac, Msg::Input { zone, input })
}

/// The last lines sent to and heard from the MTX (oldest first), to see what the box really says.
#[tauri::command]
pub fn audac_talk(audac: State<'_, Audac>) -> TalkReport {
    let t = audac.talk.lock().unwrap_or_else(|e| e.into_inner());
    TalkReport {
        lines: t.lines.iter().cloned().collect(),
        others: t.others.iter().map(|(name, (at, n))| OtherApp { name: name.clone(), ago_ms: at.elapsed().as_millis() as u64, lines: *n }).collect(),
        vu_lines: t.vu,
    }
}

/// How each zone is protected against changes by someone else (Guard, Hold, a schedule's
/// "never louder"); zones not listed are only reported.
#[tauri::command]
pub fn audac_set_guard(audac: State<'_, Audac>, rules: Vec<Rule>) -> Result<(), String> {
    post(&audac, Msg::Guard(rules))
}

#[tauri::command]
pub fn audac_set_mute(audac: State<'_, Audac>, zone: u8, mute: bool) -> Result<(), String> {
    zone_ok(zone)?;
    post(&audac, Msg::Mute { zone, mute })
}

#[cfg(test)]
mod talk_tests {
    #[test]
    fn invisible_characters_show_as_codes() {
        assert_eq!(super::visible("#|SG|X001|N10|\0\0|U|"), "#|SG|X001|N10|<00><00>|U|");
        assert_eq!(super::visible("Gym\u{FFFD}"), "Gym<?>");
        assert_eq!(super::visible("CD - USB"), "CD - USB");
    }

    #[test]
    fn tells_who_a_line_is_for() {
        assert_eq!(super::addressee("#|web|X001|VU|000^000|U|"), Some(("web".into(), "VU".into())));
        assert_eq!(super::addressee("#|SG|X001|N11|Stream Box|U|"), Some(("SG".into(), "N11".into())));
        assert_eq!(super::addressee("rubbish"), None);
        assert_eq!(super::addressee("\0#|web|X001|VU|000|U|"), Some(("web".into(), "VU".into())), "NUL first, as the real MTX sends it");
    }
}
