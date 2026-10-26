//! "What can we cast to on this network?" Finds the school's streambox (a Pro-Ject Stream Box S2 Ultra)
//! and anything like it, and says which casting "languages" each device speaks:
//!
//! - Google Cast (Android's Cast button), AirPlay (iPhone), Spotify Connect: announced over mDNS
//!   ("Bonjour"), found with the mdns-sd library.
//! - DLNA / UPnP media renderer: announced over SSDP; we ask the device's description for its name.
//!
//! The search only looks. Controlling the chosen box (volume, mute, play/pause) is in `dlna.rs` and
//! `cast.rs`; both are here so the school can test which one its streambox answers to.
//! Everything runs on blocking threads (network waits), never on the engine thread.

mod cast;
mod dlna;
mod send;

pub use send::Sending;

use std::collections::BTreeMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket};
use std::time::{Duration, Instant};

use mdns_sd::{ServiceDaemon, ServiceEvent};
use serde::Serialize;

const LISTEN: Duration = Duration::from_secs(4);

/// mDNS service type → the name people know.
const MDNS_KINDS: [(&str, &str); 4] = [
    ("_googlecast._tcp.local.", "Google Cast"),
    ("_airplay._tcp.local.", "AirPlay"),
    ("_raop._tcp.local.", "AirPlay"),
    ("_spotify-connect._tcp.local.", "Spotify Connect"),
];

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    pub ip: String,
    pub name: String,
    /// "Pro-Ject …" when the device tells us (DLNA description, Cast "md").
    pub model: Option<String>,
    /// e.g. ["AirPlay", "DLNA"]
    pub kinds: Vec<String>,
    /// DLNA only: the device's description address, needed to control it.
    pub dlna_url: Option<String>,
}

#[tauri::command]
pub async fn net_discover() -> Result<Vec<Found>, String> {
    tauri::async_runtime::spawn_blocking(discover).await.map_err(|e| e.to_string())?
}

fn discover() -> Result<Vec<Found>, String> {
    // One entry per IP address; each search adds what it learns.
    let mut by_ip: BTreeMap<Ipv4Addr, Found> = BTreeMap::new();
    let ssdp = std::thread::spawn(ssdp_renderers);
    mdns(&mut by_ip)?;
    for (ip, name, model, location) in ssdp.join().unwrap_or_default() {
        add(&mut by_ip, ip, &name, model, "DLNA");
        if let Some(f) = by_ip.get_mut(&ip) {
            f.dlna_url = Some(location);
        }
    }
    Ok(by_ip.into_values().collect())
}

fn add(by_ip: &mut BTreeMap<Ipv4Addr, Found>, ip: Ipv4Addr, name: &str, model: Option<String>, kind: &str) {
    let f = by_ip.entry(ip).or_insert_with(|| Found { ip: ip.to_string(), ..Default::default() });
    if f.name.is_empty() && !name.is_empty() {
        f.name = name.to_string();
    }
    if f.model.is_none() {
        f.model = model;
    }
    if !f.kinds.iter().any(|k| k == kind) {
        f.kinds.push(kind.to_string());
    }
}

fn mdns(by_ip: &mut BTreeMap<Ipv4Addr, Found>) -> Result<(), String> {
    let daemon = ServiceDaemon::new().map_err(|e| format!("Can't search the network: {e}"))?;
    let receivers: Vec<_> = MDNS_KINDS
        .iter()
        .filter_map(|(ty, kind)| daemon.browse(ty).ok().map(|rx| (rx, *kind)))
        .collect();
    let end = Instant::now() + LISTEN;
    while Instant::now() < end {
        for (rx, kind) in &receivers {
            while let Ok(event) = rx.try_recv() {
                if let ServiceEvent::ServiceResolved(s) = event {
                    let instance = s.fullname.split("._").next().unwrap_or("");
                    // Cast puts its friendly name in TXT "fn"; AirPlay's RAOP names look like "A1B2C3@Name".
                    let name = s
                        .txt_properties
                        .get_property_val_str("fn")
                        .map(str::to_string)
                        .unwrap_or_else(|| instance.rsplit('@').next().unwrap_or(instance).to_string());
                    let model = s
                        .txt_properties
                        .get_property_val_str("md")
                        .or_else(|| s.txt_properties.get_property_val_str("model"))
                        .map(str::to_string);
                    for ip in s.get_addresses_v4() {
                        add(by_ip, ip, &name, model.clone(), kind);
                    }
                }
            }
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let _ = daemon.shutdown();
    Ok(())
}

/// SSDP search for DLNA renderers; returns (ip, friendly name, "manufacturer model", description URL).
fn ssdp_renderers() -> Vec<(Ipv4Addr, String, Option<String>, String)> {
    let Ok(socket) = UdpSocket::bind("0.0.0.0:0") else { return vec![] };
    let _ = socket.set_read_timeout(Some(Duration::from_millis(300)));
    let search = "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n\r\n";
    let target: SocketAddr = (Ipv4Addr::new(239, 255, 255, 250), 1900).into();
    let _ = socket.send_to(search.as_bytes(), target);

    let mut locations: BTreeMap<Ipv4Addr, String> = BTreeMap::new();
    let end = Instant::now() + LISTEN;
    let mut buf = [0u8; 2048];
    while Instant::now() < end {
        if let Ok((n, from)) = socket.recv_from(&mut buf) {
            let IpAddr::V4(ip) = from.ip() else { continue };
            let text = String::from_utf8_lossy(&buf[..n]);
            if let Some(loc) = header(&text, "location") {
                locations.entry(ip).or_insert(loc);
            }
        }
    }
    locations
        .into_iter()
        .map(|(ip, loc)| {
            let xml = fetch(&loc).unwrap_or_default();
            let name = tag(&xml, "friendlyName").unwrap_or_else(|| ip.to_string());
            let model = match (tag(&xml, "manufacturer"), tag(&xml, "modelName")) {
                (Some(m), Some(n)) => Some(format!("{m} {n}")),
                (None, Some(n)) => Some(n),
                _ => None,
            };
            (ip, name, model, loc)
        })
        .collect()
}

/// When the search finds nothing (some school Wi-Fi blocks the broadcasts it listens for): ask one
/// address directly. A DLNA device answers a search sent to it alone; a Cast device listens on 8009.
#[tauri::command]
pub async fn net_probe(ip: String) -> Result<Found, String> {
    tauri::async_runtime::spawn_blocking(move || probe(&ip)).await.map_err(|e| e.to_string())?
}

fn probe(ip: &str) -> Result<Found, String> {
    let addr: Ipv4Addr = ip.trim().parse().map_err(|_| format!("Not an IP address: {ip}"))?;
    let mut f = Found { ip: addr.to_string(), name: addr.to_string(), ..Default::default() };
    // DLNA: an SSDP search sent to this device only.
    if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
        let _ = socket.set_read_timeout(Some(Duration::from_millis(1500)));
        let search = "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 1\r\nST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n\r\n";
        let _ = socket.send_to(search.as_bytes(), (addr, 1900));
        let mut buf = [0u8; 2048];
        if let Ok((n, _)) = socket.recv_from(&mut buf) {
            if let Some(loc) = header(&String::from_utf8_lossy(&buf[..n]), "location") {
                if let Some(xml) = fetch(&loc) {
                    if let Some(name) = tag(&xml, "friendlyName") {
                        f.name = name;
                    }
                    f.model = tag(&xml, "modelName");
                }
                f.kinds.push("DLNA".into());
                f.dlna_url = Some(loc);
            }
        }
    }
    // Google Cast and AirPlay: is anything listening on their ports?
    let open = |port: u16| std::net::TcpStream::connect_timeout(&SocketAddr::new(IpAddr::V4(addr), port), Duration::from_millis(800)).is_ok();
    if open(8009) {
        f.kinds.push("Google Cast".into());
    }
    if open(7000) {
        f.kinds.push("AirPlay".into());
    }
    if f.kinds.is_empty() {
        return Err(format!("{addr} doesn't answer as DLNA, Google Cast or AirPlay. Is it on and on this network?"));
    }
    Ok(f)
}

// ---------------------------------------------------------------------------------------------
// Control (docs/ipc.md, "Streambox"): `via` = "dlna" or "cast"
// ---------------------------------------------------------------------------------------------

/// What the box is doing, as far as the protocol tells us.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BoxStatus {
    /// 0–100.
    pub volume: u8,
    pub muted: bool,
    /// DLNA only (Cast doesn't tell a second sender).
    pub playing: Option<bool>,
    /// DLNA: the track title; Cast: the app's status text ("Casting: …").
    pub title: Option<String>,
    /// DLNA: the artist; Cast: the app that is casting ("Spotify").
    pub app: Option<String>,
    /// Play / pause / stop work (DLNA with AVTransport).
    pub can_transport: bool,
}

/// Where to send: the box's IP (Cast) and its description address (DLNA).
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub via: String,
    pub ip: String,
    pub dlna_url: Option<String>,
}

fn dlna_url(t: &Target) -> Result<&str, String> {
    t.dlna_url.as_deref().filter(|u| !u.is_empty()).ok_or_else(|| "Search the network again: DLNA needs the box's description address.".to_string())
}

async fn blocking<T: Send + 'static>(job: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(job).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn streambox_status(target: Target) -> Result<BoxStatus, String> {
    blocking(move || match target.via.as_str() {
        "cast" => cast::status(&target.ip),
        _ => dlna::status(dlna_url(&target)?),
    })
    .await
}

#[tauri::command]
pub async fn streambox_set_volume(target: Target, volume: u8) -> Result<(), String> {
    blocking(move || match target.via.as_str() {
        "cast" => cast::set_volume(&target.ip, volume),
        _ => dlna::set_volume(dlna_url(&target)?, volume),
    })
    .await
}

#[tauri::command]
pub async fn streambox_set_mute(target: Target, mute: bool) -> Result<(), String> {
    blocking(move || match target.via.as_str() {
        "cast" => cast::set_mute(&target.ip, mute),
        _ => dlna::set_mute(dlna_url(&target)?, mute),
    })
    .await
}

/// "play" | "pause" | "stop": DLNA only.
#[tauri::command]
pub async fn streambox_transport(target: Target, action: String) -> Result<(), String> {
    blocking(move || match target.via.as_str() {
        "cast" => Err("Google Cast doesn't let StageGremlin pause someone else's cast.".into()),
        _ => dlna::transport(dlna_url(&target)?, &action),
    })
    .await
}

/// Send StageGremlin's show output to the box (see send.rs). Returns the stream address it was given.
/// `format`: "wav" (default), "l16" (DLNA's own raw format) or "mp3" (via our ffmpeg; plays almost anywhere).
#[tauri::command]
pub async fn streambox_send_start(
    target: Target,
    format: Option<String>,
    sending: tauri::State<'_, Sending>,
    engine: tauri::State<'_, crate::engine_thread::EngineHandle>,
    yt: tauri::State<'_, crate::yt::Yt>,
) -> Result<String, String> {
    let device = engine.output_status().map(|o| o.output_name).unwrap_or_default();
    // The work blocks (network, starting the recording) but is short; State can't move to another thread.
    let ffmpeg = yt.bin_dir().join(if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" });
    send::start(&sending, target, &device, send::Codec::parse(format.as_deref()), ffmpeg)
}

#[tauri::command]
pub fn streambox_send_stop(sending: tauri::State<'_, Sending>) {
    send::stop(&sending);
}

#[tauri::command]
pub fn streambox_sending(sending: tauri::State<'_, Sending>) -> bool {
    send::is_running(&sending)
}

/// A device description is a small XML file on the device itself (its own address).
fn fetch(url: &str) -> Option<String> {
    let mut r = ureq::get(url).config().timeout_global(Some(Duration::from_secs(2))).build().call().ok()?;
    r.body_mut().read_to_string().ok()
}

fn header(response: &str, name: &str) -> Option<String> {
    response.lines().find_map(|l| {
        let (k, v) = l.split_once(':')?;
        k.trim().eq_ignore_ascii_case(name).then(|| v.trim().to_string())
    })
}

/// The text of the first `<name>…</name>` (enough for device descriptions; no XML library needed).
pub(crate) fn tag(xml: &str, name: &str) -> Option<String> {
    let start = xml.find(&format!("<{name}>"))? + name.len() + 2;
    let end = start + xml[start..].find(&format!("</{name}>"))?;
    Some(xml[start..end].trim().to_string()).filter(|s| !s.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_ssdp_and_descriptions() {
        let reply = "HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=1800\r\nLOCATION: http://10.0.0.5:49152/description.xml\r\nST: x\r\n\r\n";
        assert_eq!(header(reply, "location").as_deref(), Some("http://10.0.0.5:49152/description.xml"));
        let xml = "<root><device><friendlyName>Stream Box S2 Ultra</friendlyName><manufacturer>Pro-Ject</manufacturer><modelName>S2U</modelName></device></root>";
        assert_eq!(tag(xml, "friendlyName").as_deref(), Some("Stream Box S2 Ultra"));
        assert_eq!(tag(xml, "nothing"), None);
    }

    /// Real search on whatever network this computer is on: `cargo test -p stagegremlin live_search -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_search() {
        for f in discover().unwrap() {
            println!("{} {:?} {:?} {:?}", f.ip, f.name, f.model, f.kinds);
        }
    }

    #[test]
    fn merges_one_device_found_several_ways() {
        let mut m = BTreeMap::new();
        let ip = Ipv4Addr::new(10, 0, 0, 5);
        add(&mut m, ip, "Stream Box", None, "AirPlay");
        add(&mut m, ip, "", Some("Pro-Ject S2U".into()), "DLNA");
        add(&mut m, ip, "Other name", None, "AirPlay");
        let f = &m[&ip];
        assert_eq!((f.name.as_str(), f.model.as_deref()), ("Stream Box", Some("Pro-Ject S2U")));
        assert_eq!(f.kinds, vec!["AirPlay", "DLNA"]);
    }
}
