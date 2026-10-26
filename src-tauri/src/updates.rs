//! "Is there a newer build?" Asks GitHub for the repo's releases and compares build numbers.
//!
//! Every release is tagged `v<version>-build.<N>` by scripts/release.ps1, which also bakes that same
//! tag into the app at build time (`SG_BUILD_TAG`). A build without it (dev mode) never says
//! "update available". Nothing is downloaded or installed here: the UI offers to open the release
//! page, and the operator downloads the new zip or installer there.

use serde::{Deserialize, Serialize};

const REPO: &str = "RareGoudvis/StageGremlin";
const RELEASES_PAGE: &str = "https://github.com/RareGoudvis/StageGremlin/releases";

/// The tag this build was made as, e.g. "v0.1.0-build.9"; None in dev builds.
pub fn current_tag() -> Option<&'static str> {
    option_env!("SG_BUILD_TAG").filter(|t| !t.is_empty())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current: Option<String>,
    pub latest: Option<String>,
    /// The latest release's page (only github.com/RareGoudvis/StageGremlin/releases/…).
    pub url: Option<String>,
    pub newer: bool,
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    draft: bool,
}

/// "v0.1.0-build.9" → ((0, 1, 0), 9). Anything else → None (ignored).
fn parse(tag: &str) -> Option<((u32, u32, u32), u32)> {
    let (version, build) = tag.strip_prefix('v')?.split_once("-build.")?;
    let mut parts = version.split('.').map(|p| p.parse::<u32>().ok());
    let v = (parts.next()??, parts.next()??, parts.next()??);
    Some((v, build.parse().ok()?))
}

/// The newest tag in `tags` (by version, then build number).
fn newest<'a>(tags: impl Iterator<Item = &'a str>) -> Option<&'a str> {
    tags.filter_map(|t| parse(t).map(|p| (p, t))).max_by_key(|(p, _)| *p).map(|(_, t)| t)
}

#[tauri::command]
pub async fn app_check_update() -> Result<UpdateInfo, String> {
    tauri::async_runtime::spawn_blocking(check).await.map_err(|e| e.to_string())?
}

fn check() -> Result<UpdateInfo, String> {
    let url = format!("https://api.github.com/repos/{REPO}/releases?per_page=20");
    let mut response = ureq::get(&url)
        // GitHub's API refuses requests without a User-Agent.
        .header("User-Agent", "StageGremlin-update-check")
        .header("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| format!("Couldn't reach GitHub: {e}"))?;
    let text = response.body_mut().read_to_string().map_err(|e| format!("Couldn't read GitHub's answer: {e}"))?;
    let releases: Vec<Release> = serde_json::from_str(&text).map_err(|e| format!("Unexpected answer from GitHub: {e}"))?;
    let live: Vec<&Release> = releases.iter().filter(|r| !r.draft).collect();

    let latest = newest(live.iter().map(|r| r.tag_name.as_str()));
    let current = current_tag();
    let newer = match (latest.and_then(parse), current.and_then(parse)) {
        (Some(l), Some(c)) => l > c,
        _ => false,
    };
    let url = latest
        .and_then(|t| live.iter().find(|r| r.tag_name == t))
        .map(|r| r.html_url.clone())
        .filter(|u| u.starts_with(RELEASES_PAGE));
    Ok(UpdateInfo { current: current.map(String::from), latest: latest.map(String::from), url, newer })
}

/// Opens a release page in the default browser. Only this repo's release pages, nothing else.
#[tauri::command]
pub fn open_release_page(url: String) -> Result<(), String> {
    if !(url == RELEASES_PAGE || url.starts_with(&format!("{RELEASES_PAGE}/"))) {
        return Err("Only StageGremlin's release page can be opened.".into());
    }
    #[cfg(windows)]
    let child = std::process::Command::new("explorer").arg(&url).spawn();
    #[cfg(target_os = "macos")]
    let child = std::process::Command::new("open").arg(&url).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let child = std::process::Command::new("xdg-open").arg(&url).spawn();
    child.map(|_| ()).map_err(|e| format!("Couldn't open the browser: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_build_tags() {
        assert_eq!(parse("v0.1.0-build.9"), Some(((0, 1, 0), 9)));
        assert_eq!(parse("v1.2.3-build.12"), Some(((1, 2, 3), 12)));
        assert_eq!(parse("v0.1.0"), None);
        assert_eq!(parse("nightly"), None);
    }

    #[test]
    fn picks_the_newest_build() {
        // build.10 beats build.9 (numbers, not text); a new version beats any old build.
        assert_eq!(newest(["v0.1.0-build.9", "v0.1.0-build.10", "v0.1.0-build.7"].into_iter()), Some("v0.1.0-build.10"));
        assert_eq!(newest(["v0.1.0-build.40", "v0.2.0-build.1"].into_iter()), Some("v0.2.0-build.1"));
        assert_eq!(newest(["junk"].into_iter()), None);
    }
}
