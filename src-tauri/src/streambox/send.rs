//! Sending our sound to the streambox. The box can't receive "pushed" audio, but DLNA and Google Cast
//! both accept "play this web address". So:
//!
//! 1. A tiny web server on the laptop serves one endless WAV stream (16-bit PCM).
//! 2. The stream is what StageGremlin plays: its SHOW OUTPUT (the device the cues go to, e.g. the Qu-24),
//!    recorded with Windows "loopback" (cpal). The background player is in it too when it plays on that
//!    same device. The audio engine is not touched: this runs on its own threads.
//! 3. We tell the box (DLNA or Cast) to play http://<this laptop>:<port>/stream.wav.
//!
//! Stop: the server and the recording end, and the box is told to stop.
//! Windows Firewall may ask once whether StageGremlin may receive connections: that must be allowed.

use std::io::{Read, Write};
use std::net::{IpAddr, TcpListener, TcpStream, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use super::{cast, dlna, Target};

/// WAV (header + little-endian PCM) by default; L16 (no header, big-endian PCM, the DLNA standard's own
/// format) for boxes that refuse WAV.
fn mime(f: Format) -> String {
    if f.l16 { format!("audio/L16;rate={};channels={}", f.rate, f.channels) } else { "audio/wav".into() }
}
/// Chunks waiting per listener; a listener that falls further behind loses audio rather than memory.
const QUEUE: usize = 64;

#[derive(Default)]
pub struct Sending {
    running: Mutex<Option<Running>>,
}

struct Running {
    stop: Arc<AtomicBool>,
    target: Target,
    /// Google Cast: the media app session we started (to stop it again).
    cast_session: Option<String>,
}

/// Everyone listening to the stream gets each chunk of PCM bytes.
type Listeners = Arc<Mutex<Vec<SyncSender<Vec<u8>>>>>;

#[derive(Clone, Copy)]
struct Format {
    rate: u32,
    channels: u16,
    /// Send as L16 (big-endian, no header) instead of WAV.
    l16: bool,
}

/// Start sending the show output (`device`: its name, as the engine reports it); returns the address the box was given.
pub fn start(state: &Sending, target: Target, device: &str, l16: bool) -> Result<String, String> {
    stop(state);
    let box_ip: IpAddr = target.ip.parse().map_err(|_| "No streambox chosen.".to_string())?;
    let stop_flag = Arc::new(AtomicBool::new(false));
    let listeners: Listeners = Arc::default();

    let mut format = start_loopback(listeners.clone(), stop_flag.clone(), device.to_string())?;
    // Google Cast plays WAV, not L16.
    format.l16 = l16 && target.via != "cast";

    // The laptop's own address as the box sees it: ask the system which interface would reach the box.
    let probe = UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    probe.connect((box_ip, 9)).map_err(|e| e.to_string())?;
    let my_ip = probe.local_addr().map_err(|e| e.to_string())?.ip();

    let server = TcpListener::bind("0.0.0.0:0").map_err(|e| format!("Can't start the stream server: {e}"))?;
    let port = server.local_addr().map_err(|e| e.to_string())?.port();
    server.set_nonblocking(true).map_err(|e| e.to_string())?;
    {
        let (listeners, stop_flag) = (listeners.clone(), stop_flag.clone());
        std::thread::Builder::new()
            .name("sbx-http".into())
            .spawn(move || serve(server, listeners, format, stop_flag))
            .map_err(|e| e.to_string())?;
    }
    let url = format!("http://{my_ip}:{port}/stream.{}", if format.l16 { "pcm" } else { "wav" });

    let cast_session = match target.via.as_str() {
        "cast" => Some(cast::play_url(&target.ip, &url, &mime(format)).inspect_err(|_| stop_flag.store(true, Ordering::Relaxed))?),
        _ => {
            let desc = target.dlna_url.as_deref().filter(|u| !u.is_empty()).ok_or("Search the network again: DLNA needs the box's description address.")?;
            dlna::play_url(desc, &url, &mime(format)).inspect_err(|_| stop_flag.store(true, Ordering::Relaxed))?;
            None
        }
    };
    *state.running.lock().unwrap_or_else(|e| e.into_inner()) = Some(Running { stop: stop_flag, target, cast_session });
    Ok(url)
}

pub fn stop(state: &Sending) {
    let Some(r) = state.running.lock().unwrap_or_else(|e| e.into_inner()).take() else { return };
    r.stop.store(true, Ordering::Relaxed);
    // Best effort: tell the box to stop too.
    let _ = match (r.target.via.as_str(), &r.cast_session) {
        ("cast", Some(session)) => cast::stop_app(&r.target.ip, session),
        _ => r.target.dlna_url.as_deref().map(|d| dlna::transport(d, "stop")).unwrap_or(Ok(())),
    };
}

pub fn is_running(state: &Sending) -> bool {
    state.running.lock().unwrap_or_else(|e| e.into_inner()).is_some()
}

// ---------------------------------------------------------------- the web server

fn serve(server: TcpListener, listeners: Listeners, format: Format, stop: Arc<AtomicBool>) {
    while !stop.load(Ordering::Relaxed) {
        match server.accept() {
            Ok((conn, _)) => {
                let (listeners, stop) = (listeners.clone(), stop.clone());
                let _ = std::thread::Builder::new().name("sbx-client".into()).spawn(move || client(conn, listeners, format, stop));
            }
            Err(_) => std::thread::sleep(Duration::from_millis(100)),
        }
    }
}

fn client(mut conn: TcpStream, listeners: Listeners, format: Format, stop: Arc<AtomicBool>) {
    let _ = conn.set_nonblocking(false);
    let _ = conn.set_read_timeout(Some(Duration::from_secs(2)));
    let mut req = [0u8; 2048];
    let n = conn.read(&mut req).unwrap_or(0);
    let head_only = req[..n].starts_with(b"HEAD");
    let headers = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nConnection: close\r\nCache-Control: no-cache\r\n\
         transferMode.dlna.org: Streaming\r\ncontentFeatures.dlna.org: DLNA.ORG_OP=00;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000\r\n\r\n",
        mime(format)
    );
    if conn.write_all(headers.as_bytes()).is_err() || head_only {
        return;
    }
    if !format.l16 && conn.write_all(&wav_header(format)).is_err() {
        return;
    }
    let (tx, rx): (SyncSender<Vec<u8>>, Receiver<Vec<u8>>) = sync_channel(QUEUE);
    listeners.lock().unwrap_or_else(|e| e.into_inner()).push(tx);
    while !stop.load(Ordering::Relaxed) {
        match rx.recv_timeout(Duration::from_millis(500)) {
            Ok(mut chunk) => {
                if format.l16 {
                    // L16 is big-endian: swap each 16-bit sample.
                    chunk.chunks_exact_mut(2).for_each(|s| s.swap(0, 1));
                }
                if conn.write_all(&chunk).is_err() {
                    return; // the box hung up; its sender gets dropped below
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            Err(_) => return,
        }
    }
}

/// Hand a chunk to every listener; drop the ones that have gone.
fn broadcast(listeners: &Listeners, chunk: Vec<u8>) {
    let mut list = listeners.lock().unwrap_or_else(|e| e.into_inner());
    list.retain(|tx| !matches!(tx.try_send(chunk.clone()), Err(std::sync::mpsc::TrySendError::Disconnected(_))));
}

/// A WAV header for a stream without an end: sizes set to the maximum.
fn wav_header(f: Format) -> Vec<u8> {
    let bytes_per_frame = u32::from(f.channels) * 2;
    let mut h = Vec::with_capacity(44);
    h.extend_from_slice(b"RIFF");
    h.extend_from_slice(&u32::MAX.to_le_bytes());
    h.extend_from_slice(b"WAVEfmt ");
    h.extend_from_slice(&16u32.to_le_bytes());
    h.extend_from_slice(&1u16.to_le_bytes()); // PCM
    h.extend_from_slice(&f.channels.to_le_bytes());
    h.extend_from_slice(&f.rate.to_le_bytes());
    h.extend_from_slice(&(f.rate * bytes_per_frame).to_le_bytes());
    h.extend_from_slice(&(bytes_per_frame as u16).to_le_bytes());
    h.extend_from_slice(&16u16.to_le_bytes());
    h.extend_from_slice(b"data");
    h.extend_from_slice(&(u32::MAX - 36).to_le_bytes());
    h
}

fn to_pcm16(samples: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(samples.len() * 2);
    for s in samples {
        out.extend_from_slice(&((s.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes());
    }
    out
}

// ---------------------------------------------------------------- sources

/// Record what plays on output `name` (loopback); the Windows default when it isn't found. The stream
/// object must stay on the thread that made it, so that thread owns it and waits for the stop flag.
fn start_loopback(listeners: Listeners, stop: Arc<AtomicBool>, name: String) -> Result<Format, String> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<Format, String>>();
    std::thread::Builder::new()
        .name("sbx-loopback".into())
        .spawn(move || {
            let setup = || -> Result<(cpal::Stream, Format), String> {
                let host = cpal::default_host();
                let named = host
                    .output_devices()
                    .ok()
                    .and_then(|mut list| list.find(|d| d.description().map(|x| x.name() == name).unwrap_or(false)));
                let device = named.or_else(|| host.default_output_device()).ok_or("No sound output to record.")?;
                let config = device.default_output_config().map_err(|e| e.to_string())?;
                if config.sample_format() != cpal::SampleFormat::F32 {
                    return Err(format!("Windows output uses {:?}; only 32-bit float can be recorded for now.", config.sample_format()));
                }
                let cfg = config.config();
                let format = Format { rate: cfg.sample_rate, channels: cfg.channels, l16: false };
                let l = listeners.clone();
                let stream = device
                    .build_input_stream::<f32, _, _>(cfg, move |data, _| broadcast(&l, to_pcm16(data)), |e| eprintln!("[streambox] loopback: {e}"), None)
                    .map_err(|e| format!("Can't record the laptop's sound: {e}"))?;
                stream.play().map_err(|e| e.to_string())?;
                Ok((stream, format))
            };
            match setup() {
                Ok((stream, format)) => {
                    let _ = ready_tx.send(Ok(format));
                    while !stop.load(Ordering::Relaxed) {
                        std::thread::sleep(Duration::from_millis(200));
                    }
                    drop(stream);
                }
                Err(e) => {
                    let _ = ready_tx.send(Err(e));
                }
            }
        })
        .map_err(|e| e.to_string())?;
    ready_rx.recv_timeout(Duration::from_secs(5)).map_err(|_| "Recording the laptop's sound didn't start.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wav_header_describes_the_stream() {
        let h = wav_header(Format { rate: 48_000, channels: 2, l16: false });
        assert_eq!(h.len(), 44);
        assert_eq!(&h[0..4], b"RIFF");
        assert_eq!(u32::from_le_bytes(h[24..28].try_into().unwrap()), 48_000);
        assert_eq!(u32::from_le_bytes(h[28..32].try_into().unwrap()), 192_000, "bytes per second");
    }

    /// Real recording + web server on this computer (no box needed):
    /// `cargo test -p stagegremlin live_stream -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live_stream_serves_wav() {
        let stop = Arc::new(AtomicBool::new(false));
        let listeners: Listeners = Arc::default();
        let format = start_loopback(listeners.clone(), stop.clone(), String::new()).expect("recording starts");
        let server = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = server.local_addr().unwrap().port();
        server.set_nonblocking(true).unwrap();
        let (l, s) = (listeners.clone(), stop.clone());
        std::thread::spawn(move || serve(server, l, format, s));
        let mut r = ureq::get(&format!("http://127.0.0.1:{port}/stream.wav")).call().unwrap();
        let mut buf = vec![0u8; 44 + 64 * 1024];
        r.body_mut().as_reader().read_exact(&mut buf).unwrap();
        stop.store(true, Ordering::Relaxed);
        println!("{} Hz, {} channels, got {} bytes", format.rate, format.channels, buf.len());
        assert_eq!(&buf[0..4], b"RIFF");
    }

    #[test]
    fn l16_names_its_format() {
        assert_eq!(mime(Format { rate: 48_000, channels: 2, l16: true }), "audio/L16;rate=48000;channels=2");
        assert_eq!(mime(Format { rate: 48_000, channels: 2, l16: false }), "audio/wav");
    }

    #[test]
    fn pcm_is_clamped() {
        assert_eq!(to_pcm16(&[2.0, -2.0, 0.0]), [0xff, 0x7f, 0x01, 0x80, 0, 0]);
    }
}
