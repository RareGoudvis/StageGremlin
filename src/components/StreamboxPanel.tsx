// The streambox's remote: what plays, volume, mute, and (DLNA) play / pause / stop.
// On the Background screen and in Settings › Streambox. Buttons never take focus (Space stays free).

import { useEffect, useRef, useState } from "react";
import { useSettings } from "../settingsStore";
import { streambox, useStreambox } from "../lib/streambox";
import { useT } from "../i18n";

export function StreamboxPanel() {
  const t = useT();
  const box = useSettings((s) => s.ui.streambox);
  const { status, error, refresh } = useStreambox();
  // While dragging, show the slider's own value (the box answers a moment later).
  const [drag, setDrag] = useState<number | null>(null);
  useEffect(() => setDrag(null), [status?.volume]);
  // Dragging the slider: send only where it stops (each send is a network request, over Cast a new connection).
  const pending = useRef<number | undefined>(undefined);
  const sendVolume = (v: number) => {
    window.clearTimeout(pending.current);
    pending.current = window.setTimeout(() => void streambox.setVolume(v).catch(() => {}), 200);
  };
  const run = (p: Promise<unknown>) => p.then(refresh, () => refresh());
  // Sending our show output to the box.
  const [sending, setSending] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  useEffect(() => void streambox.sending().then(setSending, () => {}), []);
  const toggleSend = async () => {
    setSendBusy(true);
    setSendError(null);
    try {
      if (sending) await streambox.sendStop();
      else await streambox.sendStart();
      setSending(!sending);
    } catch (e) {
      setSendError(String(e));
    } finally {
      setSendBusy(false);
      refresh();
    }
  };

  if (!box.ip) return <span style={{ fontSize: 13, color: "var(--dim)" }}>{t("sbx.noneYet")}</span>;
  const vol = drag ?? status?.volume ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10, borderRadius: 10, background: "var(--p2)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 9, height: 9, borderRadius: 5, flex: "none", background: error ? "var(--amb)" : status ? "var(--acc)" : "var(--mute)" }} />
        <span className="clamp1" style={{ flex: 1, fontSize: 14, fontWeight: 700 }}>{box.name}</span>
        <span className="tag">{box.via === "cast" ? "Google Cast" : "DLNA"}</span>
      </div>
      {error ? (
        <span style={{ fontSize: 12.5, color: "var(--ambtx)" }}>{error}</span>
      ) : (
        <span className="clamp1" style={{ fontSize: 12.5, color: "var(--dim)" }}>
          {status?.title || status?.app ? [status.title, status.app].filter(Boolean).join(" · ") : status ? t("sbx.idle") : "…"}
        </span>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input type="range" tabIndex={-1} min={0} max={100} value={vol} aria-label={t("sbx.volume")} disabled={!status}
          onChange={(e) => {
            const v = Number(e.target.value);
            setDrag(v);
            sendVolume(v);
          }} style={{ flex: 1 }} />
        <span className="mono" style={{ width: 34, textAlign: "right", fontSize: 12.5 }}>{status?.muted ? "MUTE" : vol}</span>
        <button className="b chip" tabIndex={-1} disabled={!status} aria-pressed={!!status?.muted} onClick={() => run(streambox.setMute(!status?.muted))}
          style={{ background: status?.muted ? "var(--red)" : undefined, color: status?.muted ? "var(--onred)" : undefined }}>
          {t("audac.mute")}
        </button>
      </div>
      <button className="b btn" tabIndex={-1} disabled={sendBusy} onClick={() => void toggleSend()} title={t("sbx.sendHint")}
        style={{ justifyContent: "center", fontWeight: 700, background: sending ? "var(--hl)" : "var(--gobg)", color: sending ? "var(--bg)" : "var(--ongo)" }}>
        {sendBusy ? "…" : sending ? t("sbx.sendStop") : t("sbx.send")}
      </button>
      {sendError && <span style={{ fontSize: 12.5, color: "var(--redtx)" }}>{sendError}</span>}
      {status?.canTransport && (
        <div style={{ display: "flex", gap: 6 }}>
          <button className="b btn" tabIndex={-1} onClick={() => run(streambox.transport(status.playing ? "pause" : "play"))} style={{ flex: 1, justifyContent: "center" }}>
            {status.playing ? `❚❚ ${t("sbx.pause")}` : `▶ ${t("sbx.play")}`}
          </button>
          <button className="b btn" tabIndex={-1} onClick={() => run(streambox.transport("stop"))} style={{ flex: 1, justifyContent: "center" }}>■ {t("sbx.stop")}</button>
        </div>
      )}
    </div>
  );
}
