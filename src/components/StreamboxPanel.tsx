// The streambox's remote: what the box is doing, StageGremlin's stream to it, volume, mute, and
// (DLNA) play / pause / stop. On the Background screen and in Settings › Streambox.
// Compact on purpose; the stream address for checking sits behind "Check…".
// Buttons never take focus (Space stays free).

import { useEffect, useRef, useState } from "react";
import { useSettings } from "../settingsStore";
import { spotifyToBox, streambox, useStreambox, type SendReport } from "../lib/streambox";
import { call } from "../lib/tauri";
import { create } from "zustand";
import { toast } from "../uiStore";
import { useT } from "../i18n";

/** A box that reports only an ID (e.g. "0123456789AB…") gets a readable name. */
export function boxLabel(name: string, ip: string): string {
  return !name.trim() || /^[0-9a-f-]{16,}$/i.test(name.trim()) ? `Streambox · ${ip}` : name;
}

/**
 * What to send to the box: the background music (Windows default output), the show output, or any
 * output device. Changing it while sending restarts the stream with the new source.
 */
export function SourcePicker({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const source = useSettings((s) => s.ui.streambox.source) ?? "background";
  const [devices, setDevices] = useState<string[]>([]);
  useEffect(() => void call("audio_list_outputs").then((l) => setDevices(l.map((d) => d.name)), () => {}), []);
  // A device chosen earlier but not plugged in now still shows, so the choice isn't lost silently.
  const named = source.startsWith("device:") ? source.slice(7) : null;
  const list = named && !devices.includes(named) ? [...devices, named] : devices;
  const choose = async (value: string) => {
    const s = useSettings.getState();
    s.update({ streambox: { ...s.ui.streambox, source: value } });
    if ((await streambox.report().catch(() => null))?.on) {
      await streambox.sendStop().catch(() => {});
      await streambox.sendStart().catch(() => {});
    }
  };
  return (
    <select className="select" tabIndex={-1} aria-label={t("sbx.source")} title={t("sbx.sourceHint")} value={source}
      onChange={(e) => void choose(e.target.value)} style={{ flex: 1, minWidth: 0, height: compact ? 30 : 34, fontSize: compact ? 12.5 : undefined }}>
      <option value="background">{t("sbx.srcBg")}</option>
      <option value="show">{t("sbx.srcShow")}</option>
      <optgroup label={t("sbx.srcDevices")}>
        {list.map((n) => <option key={n} value={`device:${n}`}>{n}</option>)}
      </optgroup>
    </select>
  );
}

// Whether we last asked Spotify to play on the box (Spotify itself doesn't tell us).
const useConnect = create<{ onBox: boolean }>(() => ({ onBox: false }));

/** Spotify Connect: play straight on the box (the laptop plays nothing), or back in the player. */
function SpotifyConnect() {
  const t = useT();
  const onBox = useConnect((s) => s.onBox);
  const go = async (toBox: boolean) => {
    try {
      await spotifyToBox(toBox);
      useConnect.setState({ onBox: toBox });
      toast(toBox ? t("sbx.connectAsked") : t("sbx.connectBack"));
    } catch (e) {
      toast(String(e));
    }
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 12, color: "var(--dim)", flex: 1 }} title={t("sbx.connectHint")}>{t("sbx.connect")}</span>
      <button className="b chip" tabIndex={-1} aria-pressed={onBox} onClick={() => void go(!onBox)} title={t("sbx.connectHint")} style={{ height: 28, fontSize: 12 }}>
        {onBox ? t("sbx.connectOn") : t("sbx.connectOff")}
      </button>
    </div>
  );
}

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

  // Our stream to the box: on/off, its address, and whether the box is actually pulling it.
  const [report, setReport] = useState<SendReport | null>(null);
  const [sendBusy, setSendBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  useEffect(() => {
    let alive = true;
    const ask = () => streambox.report().then((r) => alive && setReport(r), () => {});
    void ask();
    const id = window.setInterval(ask, 1500);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);
  const sending = !!report?.on;
  const toggleSend = async () => {
    setSendBusy(true);
    setSendError(null);
    try {
      if (sending) await streambox.sendStop();
      else await streambox.sendStart();
      setReport(await streambox.report());
    } catch (e) {
      setSendError(String(e));
    } finally {
      setSendBusy(false);
      refresh();
    }
  };

  if (!box.ip) return <span style={{ fontSize: 13, color: "var(--dim)" }}>{t("sbx.noneYet")}</span>;
  const vol = drag ?? status?.volume ?? 0;
  const playing = status?.playing;
  const what = [status?.title, status?.app].filter(Boolean).join(" · ");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 10px", borderRadius: 10, background: "var(--p2)" }}>
      {/* Name, and what the box itself says it's doing. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 9, height: 9, borderRadius: 5, flex: "none", background: error ? "var(--amb)" : status ? "var(--acc)" : "var(--mute)" }} />
        <span className="clamp1" title={box.name} style={{ flex: 1, fontSize: 13.5, fontWeight: 700 }}>{boxLabel(box.name, box.ip)}</span>
        <span className="tag" style={{ background: playing ? "var(--acc)" : undefined, color: playing ? "var(--ongo)" : undefined }}>
          {error ? "?" : playing ? `▶ ${t("sbx.playing")}` : playing === false ? `■ ${t("sbx.stopped")}` : box.via === "cast" ? "Cast" : "DLNA"}
        </span>
      </div>
      {error ? (
        <span style={{ fontSize: 12, color: "var(--ambtx)" }}>{error}</span>
      ) : (
        <span className="clamp1" style={{ fontSize: 12, color: "var(--dim)" }}>{what || (status ? t("sbx.idle") : "…")}</span>
      )}

      {/* Our stream: is the box actually fetching it? */}
      {sending && (
        <span role="status" style={{ fontSize: 12.5, fontWeight: 700, color: report!.listeners > 0 ? "var(--acc)" : "var(--ambtx)" }}>
          {report!.listeners > 0 ? `✓ ${t("sbx.listening")}` : `… ${t("sbx.waitingBox")}`}
        </span>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input type="range" tabIndex={-1} min={0} max={100} value={vol} aria-label={t("sbx.volume")} disabled={!status}
          onChange={(e) => {
            const v = Number(e.target.value);
            setDrag(v);
            sendVolume(v);
          }} style={{ flex: 1 }} />
        <span className="mono" style={{ width: 34, textAlign: "right", fontSize: 12 }}>{status?.muted ? "MUTE" : vol}</span>
        <button className="b chip" tabIndex={-1} disabled={!status} aria-pressed={!!status?.muted} onClick={() => run(streambox.setMute(!status?.muted))}
          style={{ height: 28, background: status?.muted ? "var(--red)" : undefined, color: status?.muted ? "var(--onred)" : undefined }}>
          {t("audac.mute")}
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 12, color: "var(--dim)", flex: "none" }}>{t("sbx.sendWhat")}</span>
        <SourcePicker compact />
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button className="b btn" tabIndex={-1} disabled={sendBusy} onClick={() => void toggleSend()} title={t("sbx.sendHint")}
          style={{ flex: 2, height: 32, justifyContent: "center", fontWeight: 700, background: sending ? "var(--hl)" : "var(--gobg)", color: sending ? "var(--bg)" : "var(--ongo)" }}>
          {sendBusy ? "…" : sending ? t("sbx.sendStop") : t("sbx.sendToBox")}
        </button>
        {status?.canTransport && (
          <>
            <button className="b btn" tabIndex={-1} aria-label={status.playing ? t("sbx.pause") : t("sbx.play")} title={status.playing ? t("sbx.pause") : t("sbx.play")}
              onClick={() => run(streambox.transport(status.playing ? "pause" : "play"))} style={{ height: 32, width: 40, justifyContent: "center", padding: 0 }}>
              {status.playing ? "❚❚" : "▶"}
            </button>
            <button className="b btn" tabIndex={-1} aria-label={t("sbx.stop")} title={t("sbx.stop")} onClick={() => run(streambox.transport("stop"))}
              style={{ height: 32, width: 40, justifyContent: "center", padding: 0 }}>■</button>
          </>
        )}
        {sending && (
          <button className="b btn btn-ghost" tabIndex={-1} aria-pressed={details} onClick={() => setDetails(!details)} style={{ height: 32, fontSize: 12 }}>{t("sbx.checkMore")}</button>
        )}
      </div>
      {sendError && <span style={{ fontSize: 12, color: "var(--redtx)" }}>{sendError}</span>}
      <SpotifyConnect />

      {/* The check that splits a problem in two: if a phone plays this address, laptop + firewall are fine. */}
      {sending && details && report?.url && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span className="mono clamp1" style={{ flex: 1, fontSize: 11.5, userSelect: "text" }}>{report.url}</span>
            <button className="b btn btn-ghost" tabIndex={-1} onClick={() => void navigator.clipboard?.writeText(report.url!).catch(() => {})} style={{ height: 24, fontSize: 12 }}>{t("sbx.copy")}</button>
          </span>
          <span style={{ fontSize: 11.5, color: "var(--dim)" }}>{t("sbx.urlHint")} {(box.source ?? "background") === "show" ? t("sbx.onlyShow") : (box.source ?? "background") === "background" ? t("sbx.onlyBg") : ""}</span>
        </div>
      )}
    </div>
  );
}
