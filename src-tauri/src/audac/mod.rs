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

use std::io::{ErrorKind, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use protocol::{Update, MIN_VOLUME, NAMES, ZONES};

const RETRY_EVERY: Duration = Duration::from_secs(3);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
/// Ask for the state now and then: keeps the link alive and notices a dead one.
const POLL_EVERY: Duration = Duration::from_secs(15);
/// No answer for this long after a poll = the link is gone (cable out, box off).
const DEAD_AFTER: Duration = Duration::from_secs(40);
/// Gap between our own questions: the MTX may drop a command that arrives right on top of another.
const ASK_GAP: Duration = Duration::from_millis(250);
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
}

enum Msg {
    Connect { host: String, port: u16 },
    Disconnect,
    Volume { zone: u8, db: u8 },
    Step { zone: u8, up: bool },
    Input { zone: u8, input: u8 },
    Mute { zone: u8, mute: bool },
}

/// Managed by Tauri; the commands below talk to the thread through it.
pub struct Audac {
    tx: Mutex<Sender<Msg>>,
    state: Arc<Mutex<AudacState>>,
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
    }));
    let (tx, rx) = mpsc::channel();
    let shared = state.clone();
    std::thread::Builder::new()
        .name("audac".into())
        .spawn(move || Link { app, state: shared, rx, stream: None, buf: Vec::new(), heard: false, got: [false; 3], got_names: [false; NAMES] }.run())
        .expect("could not start the AUDAC thread");
    Audac { tx: Mutex::new(tx), state }
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
}

impl Link {
    fn run(mut self) {
        let mut target: Option<(String, u16)> = None;
        let mut next_try = Instant::now();
        let mut last_poll = Instant::now();
        let mut last_heard = Instant::now();
        // Questions waiting to go out, one every ASK_GAP (see get_all).
        let mut asks: std::collections::VecDeque<String> = Default::default();
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
                        });
                    }
                    Msg::Volume { zone, db } => {
                        pending_volume[zone as usize - 1] = Some(db);
                        // Show it right away; the MTX's own update confirms it a moment later.
                        self.update(|s| s.zones[zone as usize - 1].volume = db);
                    }
                    Msg::Step { zone, up } => self.send(&if up { protocol::volume_up(zone) } else { protocol::volume_down(zone) }),
                    Msg::Input { zone, input } => {
                        self.send(&protocol::set_input(zone, input));
                        self.update(|s| s.zones[zone as usize - 1].input = input);
                    }
                    Msg::Mute { zone, mute } => {
                        self.send(&protocol::set_mute(zone, mute));
                        self.update(|s| s.zones[zone as usize - 1].mute = mute);
                    }
                }
            }
            for (i, v) in pending_volume.iter_mut().enumerate() {
                if let Some(db) = v.take() {
                    self.send(&protocol::set_volume(i as u8 + 1, db));
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
                if Instant::now() >= next_ask {
                    if let Some(l) = asks.pop_front() {
                        self.send(&l);
                        next_ask = Instant::now() + ASK_GAP;
                    }
                }
                if last_poll.elapsed() >= POLL_EVERY {
                    last_poll = Instant::now();
                    self.send(&protocol::line("GMALL", "0"));
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
                self.buf.extend_from_slice(&chunk[..n]);
                // The manual ends lines with "return": that may be CR only, CR LF, or LF. Accept all.
                while let Some(end) = self.buf.iter().position(|&b| b == b'\n' || b == b'\r') {
                    let raw: Vec<u8> = self.buf.drain(..=end).collect();
                    let text = String::from_utf8_lossy(&raw);
                    if text.trim().is_empty() {
                        continue;
                    }
                    eprintln!("[audac] < {}", text.trim());
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
        // The panel opens as soon as we know the volumes: inputs and mutes follow (re-asked if dropped).
        let known = self.got[0];
        self.update(|s| {
            if known {
                s.known = true;
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

    fn send(&mut self, line: &str) {
        let Some(stream) = self.stream.as_mut() else { return };
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

#[tauri::command]
pub fn audac_set_mute(audac: State<'_, Audac>, zone: u8, mute: bool) -> Result<(), String> {
    zone_ok(zone)?;
    post(&audac, Msg::Mute { zone, mute })
}
