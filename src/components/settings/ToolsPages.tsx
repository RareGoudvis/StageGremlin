// Settings › TOOLS: the YouTube helpers (yt-dlp, ffmpeg) and About.

import { exportSettings, importSettings } from "../../lib/settingsTransfer";
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
          <span style={{ fontSize: 12.5, color: "var(--dim)" }}>{have ? t("s.tools.installed") : t("s.tools.notInstalled")} {detail}</span>
        </span>
        {pct !== undefined ? (
          <span className="mono" style={{ fontSize: 12.5, width: 120 }}>
            <span style={{ display: "block", height: 6, borderRadius: 3, background: "var(--p3)", overflow: "hidden", marginBottom: 4 }}>
              <span style={{ display: "block", height: "100%", width: `${pct}%`, background: "var(--amb)" }} />
            </span>
            {Math.round(pct)}%
          </span>
        ) : (
          <button className="b btn" onClick={() => void useTools.getState().install(what)}>{have ? (what === "ytDlp" ? t("s.tools.update") : t("s.tools.reinstall")) : t("s.tools.install")}</button>
        )}
      </div>
    );
  };
  return (
    <>
      <PageTitle note={t("set.storedLaptop")}>{t("set.importTools")}</PageTitle>
      <Card title={t("s.tools.yt")}>
        <Row label={t("s.tools.defFormat")}>
          <Chips<"original" | "mp3" | "wav"> label={t("s.tools.defFormatLabel")} value={ui.ytFormat} onChange={(ytFormat) => update({ ytFormat })}
            options={[{ value: "original", label: t("s.tools.original") }, { value: "mp3", label: "MP3" }, { value: "wav", label: "WAV" }]} />
        </Row>
      </Card>
      <Card title={t("s.tools.tools")} note={t("s.tools.note")}>
        {tool("ytDlp", t("s.tools.ytDlp"))}
        {tool("ffmpeg", t("s.tools.ffmpeg"))}
        {status && <span className="mono" style={{ fontSize: 12, color: "var(--mute)" }}>{t("s.tools.folder", { dir: status.binDir })}</span>}
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
        <span style={{ fontSize: 15, color: "var(--dim)" }}>{t("s.about.tagline")}</span>
      </div>
      <Card>
        <Row label={t("s.about.version")}><span className="mono">{info?.version ?? "…"} · {buildLabel(info?.build ?? null)}</span></Row>
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
        <Row label={t("s.about.portable")}><span>{info ? (info.portable ? t("s.about.portableYes") : t("s.about.portableNo")) : "…"}</span></Row>
        <Row label={t("s.about.dataFolder")}>
          <span className="mono" style={{ fontSize: 12.5, wordBreak: "break-all", userSelect: "text", flex: 1 }}>{info?.dataDir ?? "…"}</span>
          {info?.dataDir && <button className="b btn" onClick={() => void call("show_in_folder", { path: info.dataDir }).catch(() => {})}>{t("s.about.open")}</button>}
        </Row>
        <Row label={t("s.about.licence")}><span>AGPL-3.0</span></Row>
        <Row label={t("s.about.source")}><span className="mono" style={{ userSelect: "text" }}>github.com/RareGoudvis/StageGremlin</span></Row>
      </Card>
      <Card title={t("set.transfer")} note={t("set.transferNote")}>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="b btn" onClick={() => void exportSettings()}>{t("set.export")}</button>
          <button className="b btn" onClick={() => void importSettings()}>{t("set.import")}</button>
        </div>
      </Card>
    </>
  );
}
