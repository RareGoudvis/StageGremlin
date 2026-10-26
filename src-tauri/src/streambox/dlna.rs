//! Controlling a DLNA / UPnP media renderer (what Windows' "Cast to device" uses): volume, mute,
//! play / pause / stop, and what it plays. Plain HTTP + small SOAP messages; the device's own
//! description (found during the network search) says where to send them.

use std::time::Duration;

use super::{tag, BoxStatus};

const TIMEOUT: Duration = Duration::from_secs(3);

/// The two services we use, as the device describes them.
struct Services {
    rendering: Option<(String, String)>, // (serviceType, absolute control URL)
    transport: Option<(String, String)>,
}

fn services(desc_url: &str) -> Result<Services, String> {
    let xml = get(desc_url)?;
    // Relative control URLs are relative to the description's host (or <URLBase> when given).
    let base = tag(&xml, "URLBase").unwrap_or_else(|| origin(desc_url));
    let mut out = Services { rendering: None, transport: None };
    for block in xml.split("<service>").skip(1) {
        let block = block.split("</service>").next().unwrap_or("");
        let (Some(ty), Some(ctl)) = (tag(block, "serviceType"), tag(block, "controlURL")) else { continue };
        let url = if ctl.starts_with("http") { ctl } else { join(&base, &ctl) };
        if ty.contains(":RenderingControl:") {
            out.rendering = Some((ty, url));
        } else if ty.contains(":AVTransport:") {
            out.transport = Some((ty, url));
        }
    }
    Ok(out)
}

pub fn status(desc_url: &str) -> Result<BoxStatus, String> {
    let s = services(desc_url)?;
    let (ty, url) = s.rendering.ok_or("This device has no volume control (RenderingControl).")?;
    let vol = soap(&url, &ty, "GetVolume", "<InstanceID>0</InstanceID><Channel>Master</Channel>")?;
    let mute = soap(&url, &ty, "GetMute", "<InstanceID>0</InstanceID><Channel>Master</Channel>").unwrap_or_default();
    let mut st = BoxStatus {
        volume: tag(&vol, "CurrentVolume").and_then(|v| v.parse().ok()).unwrap_or(0),
        muted: tag(&mute, "CurrentMute").map(|m| m == "1" || m == "true").unwrap_or(false),
        can_transport: s.transport.is_some(),
        ..Default::default()
    };
    if let Some((ty, url)) = &s.transport {
        if let Ok(info) = soap(url, ty, "GetTransportInfo", "<InstanceID>0</InstanceID>") {
            st.playing = tag(&info, "CurrentTransportState").map(|state| state == "PLAYING");
        }
        if let Ok(pos) = soap(url, ty, "GetPositionInfo", "<InstanceID>0</InstanceID>") {
            // The track's details are a small XML document, escaped inside the answer.
            let meta = unescape(&tag(&pos, "TrackMetaData").unwrap_or_default());
            st.title = tag(&meta, "dc:title");
            st.app = tag(&meta, "upnp:artist").or_else(|| tag(&meta, "dc:creator"));
        }
    }
    Ok(st)
}

pub fn set_volume(desc_url: &str, volume: u8) -> Result<(), String> {
    let (ty, url) = services(desc_url)?.rendering.ok_or("This device has no volume control.")?;
    let args = format!("<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>{}</DesiredVolume>", volume.min(100));
    soap(&url, &ty, "SetVolume", &args).map(|_| ())
}

pub fn set_mute(desc_url: &str, mute: bool) -> Result<(), String> {
    let (ty, url) = services(desc_url)?.rendering.ok_or("This device has no volume control.")?;
    let args = format!("<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredMute>{}</DesiredMute>", u8::from(mute));
    soap(&url, &ty, "SetMute", &args).map(|_| ())
}

/// "play", "pause" or "stop".
pub fn transport(desc_url: &str, action: &str) -> Result<(), String> {
    let (ty, url) = services(desc_url)?.transport.ok_or("This device can't be started or stopped remotely.")?;
    let (name, args) = match action {
        "play" => ("Play", "<InstanceID>0</InstanceID><Speed>1</Speed>"),
        "pause" => ("Pause", "<InstanceID>0</InstanceID>"),
        "stop" => ("Stop", "<InstanceID>0</InstanceID>"),
        _ => return Err(format!("Unknown action {action}")),
    };
    soap(&url, &ty, name, args).map(|_| ())
}

fn soap(url: &str, service: &str, action: &str, args: &str) -> Result<String, String> {
    let body = format!(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" \
         s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:{action} xmlns:u=\"{service}\">{args}</u:{action}></s:Body></s:Envelope>"
    );
    let mut r = ureq::post(url)
        .config()
        .timeout_global(Some(TIMEOUT))
        .build()
        .header("Content-Type", "text/xml; charset=\"utf-8\"")
        .header("SOAPAction", &format!("\"{service}#{action}\""))
        .send(body)
        .map_err(|e| format!("The streambox didn't accept {action}: {e}"))?;
    r.body_mut().read_to_string().map_err(|e| e.to_string())
}

fn get(url: &str) -> Result<String, String> {
    let mut r = ureq::get(url)
        .config()
        .timeout_global(Some(TIMEOUT))
        .build()
        .call()
        .map_err(|e| format!("Can't reach the streambox: {e}"))?;
    r.body_mut().read_to_string().map_err(|e| e.to_string())
}

/// "http://10.0.0.5:49152/desc.xml" → "http://10.0.0.5:49152"
fn origin(url: &str) -> String {
    let after = url.find("://").map(|i| i + 3).unwrap_or(0);
    match url[after..].find('/') {
        Some(i) => url[..after + i].to_string(),
        None => url.to_string(),
    }
}

fn join(base: &str, path: &str) -> String {
    format!("{}/{}", base.trim_end_matches('/'), path.trim_start_matches('/'))
}

fn unescape(s: &str) -> String {
    s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_control_urls() {
        assert_eq!(origin("http://10.0.0.5:49152/description.xml"), "http://10.0.0.5:49152");
        assert_eq!(join("http://10.0.0.5:49152", "/upnp/control/rc"), "http://10.0.0.5:49152/upnp/control/rc");
        assert_eq!(join("http://10.0.0.5:49152/", "upnp/control/rc"), "http://10.0.0.5:49152/upnp/control/rc");
    }

    #[test]
    fn reads_the_track_title() {
        let pos = "<TrackMetaData>&lt;DIDL-Lite&gt;&lt;item&gt;&lt;dc:title&gt;Levitating&lt;/dc:title&gt;&lt;upnp:artist&gt;Dua Lipa&lt;/upnp:artist&gt;&lt;/item&gt;&lt;/DIDL-Lite&gt;</TrackMetaData>";
        let meta = unescape(&tag(pos, "TrackMetaData").unwrap());
        assert_eq!(tag(&meta, "dc:title").as_deref(), Some("Levitating"));
        assert_eq!(tag(&meta, "upnp:artist").as_deref(), Some("Dua Lipa"));
    }
}
