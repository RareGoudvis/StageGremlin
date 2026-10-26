//! Controlling a Google Cast device (what Android's Cast button uses): volume, mute, and which app is
//! casting. Cast doesn't let another sender pause someone else's cast, so there is no play/pause here.
//!
//! The protocol ("CASTV2"): a TLS connection to port 8009, then small messages, each a 4-byte length
//! plus a tiny protobuf record (`CastMessage`) carrying a JSON text. We open a short connection per
//! request: connect, say hello, ask, read the answer, close.
//!
//! Cast devices use their own certificates that no public authority signs, so the certificate is NOT
//! checked (every Cast sender does the same). What we send is only volume and status on the school
//! network; nothing secret travels over it.

use std::io::{Read, Write};
use std::net::{IpAddr, SocketAddr, TcpStream};
use std::sync::Arc;
use std::time::{Duration, Instant};

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::CryptoProvider;
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{ClientConfig, ClientConnection, DigitallySignedStruct, SignatureScheme, StreamOwned};
use serde_json::{json, Value};

use super::BoxStatus;

const PORT: u16 = 8009;
const TIMEOUT: Duration = Duration::from_secs(3);
const NS_CONNECTION: &str = "urn:x-cast:com.google.cast.tp.connection";
const NS_RECEIVER: &str = "urn:x-cast:com.google.cast.receiver";

pub fn status(ip: &str) -> Result<BoxStatus, String> {
    let s = ask(ip, json!({ "type": "GET_STATUS" }))?;
    Ok(read_status(&s))
}

/// `volume` 0–100 (Cast uses 0.0–1.0).
pub fn set_volume(ip: &str, volume: u8) -> Result<(), String> {
    ask(ip, json!({ "type": "SET_VOLUME", "volume": { "level": f64::from(volume.min(100)) / 100.0 } })).map(|_| ())
}

pub fn set_mute(ip: &str, mute: bool) -> Result<(), String> {
    ask(ip, json!({ "type": "SET_VOLUME", "volume": { "muted": mute } })).map(|_| ())
}

/// Google's built-in "Default Media Receiver" app plays any web address it is given.
const MEDIA_APP: &str = "CC1AD845";
const NS_MEDIA: &str = "urn:x-cast:com.google.cast.media";

/// Start the media app on the box and let it play `url`. Returns the app's session (to stop it later).
pub fn play_url(ip: &str, url: &str, mime: &str) -> Result<String, String> {
    let ip_addr: IpAddr = ip.parse().map_err(|_| format!("Not an IP address: {ip}"))?;
    let mut conn = connect(ip_addr)?;
    send(&mut conn, "receiver-0", NS_CONNECTION, &json!({ "type": "CONNECT" }))?;
    send(&mut conn, "receiver-0", NS_RECEIVER, &json!({ "type": "LAUNCH", "appId": MEDIA_APP, "requestId": 1 }))?;
    // Wait until the app runs; its transportId is where media messages go.
    let end = Instant::now() + Duration::from_secs(10);
    let (transport, session) = loop {
        if Instant::now() > end {
            return Err("The streambox didn't start Google's media app.".into());
        }
        let (ns, payload) = receive(&mut conn)?;
        if ns != NS_RECEIVER {
            continue;
        }
        let v: Value = serde_json::from_str(&payload).map_err(|e| e.to_string())?;
        let apps = v["status"]["applications"].as_array().cloned().unwrap_or_default();
        if let Some(app) = apps.iter().find(|a| a["appId"] == MEDIA_APP) {
            if let (Some(t), Some(s)) = (app["transportId"].as_str(), app["sessionId"].as_str()) {
                break (t.to_string(), s.to_string());
            }
        }
    };
    send(&mut conn, &transport, NS_CONNECTION, &json!({ "type": "CONNECT" }))?;
    send(&mut conn, &transport, NS_MEDIA, &json!({
        "type": "LOAD", "requestId": 2, "autoplay": true,
        "media": { "contentId": url, "contentType": mime, "streamType": "LIVE",
                   "metadata": { "metadataType": 0, "title": "StageGremlin" } }
    }))?;
    // Give the box a moment to take it before we hang up (the app keeps playing without us).
    let wait = Instant::now() + Duration::from_secs(3);
    while Instant::now() < wait {
        if let Ok((ns, payload)) = receive(&mut conn) {
            if ns == NS_MEDIA && (payload.contains("MEDIA_STATUS") || payload.contains("LOAD_FAILED")) {
                if payload.contains("LOAD_FAILED") {
                    return Err("The streambox couldn't play our stream (Google Cast LOAD_FAILED).".into());
                }
                break;
            }
        }
    }
    Ok(session)
}

/// Stop the media app we started.
pub fn stop_app(ip: &str, session: &str) -> Result<(), String> {
    ask(ip, json!({ "type": "STOP", "sessionId": session })).map(|_| ())
}

fn read_status(v: &Value) -> BoxStatus {
    let st = &v["status"];
    let app = st["applications"].get(0);
    BoxStatus {
        volume: (st["volume"]["level"].as_f64().unwrap_or(0.0) * 100.0).round() as u8,
        muted: st["volume"]["muted"].as_bool().unwrap_or(false),
        playing: None,
        // e.g. app "Spotify", text "Casting: Levitating"
        app: app.and_then(|a| a["displayName"].as_str()).map(String::from),
        title: app.and_then(|a| a["statusText"].as_str()).map(String::from),
        can_transport: false,
    }
}

/// One request on the receiver channel; returns the RECEIVER_STATUS that answers it.
fn ask(ip: &str, mut request: Value) -> Result<Value, String> {
    let ip: IpAddr = ip.parse().map_err(|_| format!("Not an IP address: {ip}"))?;
    let mut conn = connect(ip)?;
    send(&mut conn, "receiver-0", NS_CONNECTION, &json!({ "type": "CONNECT" }))?;
    request["requestId"] = json!(1);
    send(&mut conn, "receiver-0", NS_RECEIVER, &request)?;
    let end = Instant::now() + TIMEOUT;
    while Instant::now() < end {
        let (ns, payload) = receive(&mut conn)?;
        if ns == NS_RECEIVER {
            let v: Value = serde_json::from_str(&payload).map_err(|e| e.to_string())?;
            if v["type"] == "RECEIVER_STATUS" {
                let _ = send(&mut conn, "receiver-0", NS_CONNECTION, &json!({ "type": "CLOSE" }));
                return Ok(v);
            }
        }
    }
    Err("The streambox didn't answer (Google Cast).".into())
}

type Tls = StreamOwned<ClientConnection, TcpStream>;

fn connect(ip: IpAddr) -> Result<Tls, String> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = ClientConfig::builder_with_provider(provider.clone())
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(AcceptCastCert(provider)))
        .with_no_client_auth();
    let tls = ClientConnection::new(Arc::new(config), ServerName::IpAddress(ip.into())).map_err(|e| e.to_string())?;
    let sock = TcpStream::connect_timeout(&SocketAddr::new(ip, PORT), TIMEOUT)
        .map_err(|_| format!("No Google Cast answer from {ip} (port {PORT})."))?;
    sock.set_read_timeout(Some(TIMEOUT)).map_err(|e| e.to_string())?;
    sock.set_write_timeout(Some(TIMEOUT)).map_err(|e| e.to_string())?;
    Ok(StreamOwned::new(tls, sock))
}

fn send(conn: &mut Tls, dest: &str, namespace: &str, payload: &Value) -> Result<(), String> {
    let msg = encode("sender-0", dest, namespace, &payload.to_string());
    conn.write_all(&(msg.len() as u32).to_be_bytes()).map_err(|e| e.to_string())?;
    conn.write_all(&msg).map_err(|e| e.to_string())?;
    conn.flush().map_err(|e| e.to_string())
}

fn receive(conn: &mut Tls) -> Result<(String, String), String> {
    let mut len = [0u8; 4];
    conn.read_exact(&mut len).map_err(|e| format!("Google Cast: {e}"))?;
    let len = u32::from_be_bytes(len) as usize;
    if len > 1 << 20 {
        return Err("Google Cast: message too large.".into());
    }
    let mut buf = vec![0u8; len];
    conn.read_exact(&mut buf).map_err(|e| format!("Google Cast: {e}"))?;
    Ok(decode(&buf))
}

// ---- CastMessage, hand-written protobuf (6 fields; not worth a code generator) ----
// 1 protocol_version (varint, 0) · 2 source_id · 3 destination_id · 4 namespace · 5 payload_type (varint, 0 = text) · 6 payload_utf8

fn varint(mut v: u64, out: &mut Vec<u8>) {
    while v >= 0x80 {
        out.push((v as u8) | 0x80);
        v >>= 7;
    }
    out.push(v as u8);
}

fn text_field(field: u8, s: &str, out: &mut Vec<u8>) {
    out.push((field << 3) | 2);
    varint(s.len() as u64, out);
    out.extend_from_slice(s.as_bytes());
}

fn encode(source: &str, dest: &str, namespace: &str, payload: &str) -> Vec<u8> {
    let mut out = vec![0x08, 0x00]; // protocol_version = CASTV2_1_0
    text_field(2, source, &mut out);
    text_field(3, dest, &mut out);
    text_field(4, namespace, &mut out);
    out.extend_from_slice(&[0x28, 0x00]); // payload_type = STRING
    text_field(6, payload, &mut out);
    out
}

/// Returns (namespace, payload text); other fields are skipped.
fn decode(buf: &[u8]) -> (String, String) {
    let (mut ns, mut payload) = (String::new(), String::new());
    let mut i = 0;
    let read_varint = |i: &mut usize| -> u64 {
        let (mut v, mut shift) = (0u64, 0);
        while *i < buf.len() {
            let b = buf[*i];
            *i += 1;
            v |= u64::from(b & 0x7f) << shift;
            if b & 0x80 == 0 {
                break;
            }
            shift += 7;
        }
        v
    };
    while i < buf.len() {
        let key = read_varint(&mut i);
        let (field, wire) = (key >> 3, key & 7);
        match wire {
            0 => {
                read_varint(&mut i);
            }
            2 => {
                let len = read_varint(&mut i) as usize;
                let end = (i + len).min(buf.len());
                let s = String::from_utf8_lossy(&buf[i..end]).into_owned();
                match field {
                    4 => ns = s,
                    6 => payload = s,
                    _ => {}
                }
                i = end;
            }
            _ => break, // nothing else appears in CastMessage
        }
    }
    (ns, payload)
}

/// Cast devices present certificates signed by Google's device authority, not a public one,
/// so normal checking would always fail. See the module comment.
#[derive(Debug)]
struct AcceptCastCert(Arc<CryptoProvider>);

impl ServerCertVerifier for AcceptCastCert {
    fn verify_server_cert(&self, _: &CertificateDer<'_>, _: &[CertificateDer<'_>], _: &ServerName<'_>, _: &[u8], _: UnixTime) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }
    fn verify_tls12_signature(&self, _: &[u8], _: &CertificateDer<'_>, _: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }
    fn verify_tls13_signature(&self, _: &[u8], _: &CertificateDer<'_>, _: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.0.signature_verification_algorithms.supported_schemes()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cast_messages_go_round_trip() {
        let msg = encode("sender-0", "receiver-0", NS_RECEIVER, r#"{"type":"GET_STATUS","requestId":1}"#);
        assert_eq!(decode(&msg), (NS_RECEIVER.to_string(), r#"{"type":"GET_STATUS","requestId":1}"#.to_string()));
        // A long payload needs a two-byte length.
        let long = "x".repeat(300);
        assert_eq!(decode(&encode("a", "b", "c", &long)).1, long);
    }

    #[test]
    fn reads_receiver_status() {
        let v: Value = serde_json::from_str(
            r#"{"type":"RECEIVER_STATUS","status":{"volume":{"level":0.42,"muted":false},"applications":[{"displayName":"Spotify","statusText":"Casting: Levitating"}]}}"#,
        ).unwrap();
        let s = read_status(&v);
        assert_eq!((s.volume, s.muted, s.app.as_deref(), s.title.as_deref()), (42, false, Some("Spotify"), Some("Casting: Levitating")));
    }
}
