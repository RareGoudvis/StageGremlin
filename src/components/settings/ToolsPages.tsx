// Settings › TOOLS: the YouTube helpers (yt-dlp, ffmpeg) and About.

import { useEffect, useState } from "react";
import { useSettings } from "../../settingsStore";
import { useT } from "../../i18n";
import { call } from "../../lib/tauri";
import { hasTool, TOOL_NAME, useTools } from "../../lib/tools";
import { Chips, Row } from "../controls";
import { Card, PageTitle } from "./common";
import { buildLabel, openReleasePage, useUpdates } from "../../lib/updates";
import logo from "../../assets/logo.png";

export function ToolsPage() {
  const t = useT();
  const status = useTools((s) => s.status);
  const installing = useTools((s) => s.installing);
  const ui = useSettings((s) => s.ui);
  const update = useSettings((s) => s.update);
  useEffect(() => void useTools.getState().refresh(), []);
  const tool = (what: "ytDlp" | "ffmpeg", detail: string) => {
    const have = hasTool(status, what);
    const pct = installing[what];
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ width: 10, height: 10, borderRadius: 5, background: have ? "var(--acc)" : "var(--amb)" }} />
        <span style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{TOOL_NAME[what]} {what === "ytDlp" && status?.ytDlp ? <span className="mono" style={{ fontSize: 12, color: "var(--dim)" }}>{status.ytDlp}</span> : null}</span>
          <span style={{ fontSize: 12.5, color: "var(--dim)" }}>{have ? "Installed. " : "Not installed. "}{detail}</span>
        </span>
        {pct !== undefined ? (
          <span className="mono" style={{ fontSize: 12.5, width: 120 }}>
            <span style={{ display: "block", height: 6, borderRadius: 3, background: "var(--p3)", overflow: "hidden", marginBottom: 4 }}>
              <span style={{ display: "block", height: "100%", width: `${pct}%`, background: "var(--amb)" }} />
            </span>
            {Math.round(pct)}%
          </span>
        ) : (
          <button className="b btn" onClick={() => void useTools.getState().install(what)}>{have ? (what === "ytDlp" ? "Update" : "Reinstall") : "Install"}</button>
        )}
      </div>
    );
  };
  return (
    <>
      <PageTitle note={t("set.storedLaptop")}>{t("set.importTools")}</PageTitle>
      <Card title="YouTube downloads">
        <Row label="Default format">
          <Chips<"original" | "mp3" | "wav"> label="Default download format" value={ui.ytFormat} onChange={(ytFormat) => update({ ytFormat })}
            options={[{ value: "original", label: "Original (M4A)" }, { value: "mp3", label: "MP3" }, { value: "wav", label: "WAV" }]} />
        </Row>
      </Card>
      <Card title="Tools" note="Nothing is bundled with the app: these are downloaded on request into the app's data folder.">
        {tool("ytDlp", "Downloads audio from YouTube. YouTube changes often: update it before a show.")}
        {tool("ffmpeg", "Only needed for MP3/WAV downloads and for converting opus/webm files.")}
        {status && <span className="mono" style={{ fontSize: 12, color: "var(--mute)" }}>Folder: {status.binDir}</span>}
      </Card>
    </>
  );
}

export function AboutPage() {
  const t = useT();
  const [info, setInfo] = useState<{ version: string; portable: boolean; dataDir: string; build?: string | null } | null>(null);
  const upd = useUpdates();
  useEffect(() => {
    call("app_info").then(setInfo, () => setInfo(null));
  }, []);
  return (
    <>
      {/* The logo already carries the name, so no separate title. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
        <img src={logo} alt="StageGremlin" width={360} style={{ height: "auto", borderRadius: 16 }} />
        <span style={{ fontSize: 15, color: "var(--dim)" }}>A cue player for school shows. Build → Preflight → Run.</span>
      </div>
      <Card>
        <Row label="Version"><span className="mono">{info?.version ?? "…"} · {buildLabel(info?.build ?? null)}</span></Row>
        <Row label={t("upd.updates")}>
          <span style={{ flex: 1, fontSize: 13, color: upd.info?.newer ? "var(--cy)" : upd.error ? "var(--redtx)" : "var(--dim)" }}>
            {upd.checking ? t("upd.checking")
              : upd.error ? upd.error
              : upd.info?.newer ? `${t("upd.available")} ${buildLabel(upd.info.latest)}`
              : upd.info ? (upd.info.current ? t("upd.upToDate") : t("upd.devBuild"))
              : ""}
          </span>
          {upd.info?.newer && upd.info.url && <button className="b btn btn-go" onClick={() => openReleasePage(upd.info!.url!)}>{t("upd.download")}</button>}
          <button className="b btn" disabled={upd.checking} onClick={() => void upd.check()}>{t("upd.check")}</button>
        </Row>
        <Row label="Portable"><span>{info ? (info.portable ? "Yes: settings and data live next to the app" : "No: installed version") : "…"}</span></Row>
        <Row label="Data folder">
          <span className="mono" style={{ fontSize: 12.5, wordBreak: "break-all", userSelect: "text", flex: 1 }}>{info?.dataDir ?? "…"}</span>
          {info?.dataDir && <button className="b btn" onClick={() => void call("show_in_folder", { path: info.dataDir }).catch(() => {})}>Open</button>}
        </Row>
        <Row label="Licence"><span>AGPL-3.0</span></Row>
        <Row label="Source"><span className="mono" style={{ userSelect: "text" }}>github.com/RareGoudvis/StageGremlin</span></Row>
      </Card>
    </>
  );
}
