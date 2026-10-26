// The AUDAC remote: one row per zone with its input (aux, streambox, mic…), volume and mute.
// Used in Run's dock (AUDAC tab) and in the window behind the top bar's AUDAC button.
// Buttons never take keyboard focus (tabIndex -1): in Run, Space must stay GO.

import { useEffect, useState } from "react";
import { useSettings } from "../../settingsStore";
import { useUi } from "../../uiStore";
import { audac, audacConnectSaved, MIN_VOLUME, useAudac, visible, type AudacState } from "../../lib/audac";
import { useT } from "../../i18n";

export function AudacPanel({ big = false, inRun = false }: { big?: boolean; inRun?: boolean }) {
  const t = useT();
  const st = useAudac();
  const setup = useSettings((s) => s.ui.audac);
  const zones = visible(setup.zones);
  const inputs = visible(setup.inputs);
  // In Run the panel can start locked: you see the levels, but a stray tap changes nothing.
  const [unlocked, setUnlocked] = useState(false);
  const locked = inRun && setup.inRun === "locked" && !unlocked;
  const live = st?.status === "connected" && st.known && !locked;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: big ? 10 : 6, minHeight: 0 }}>
      <StatusBar st={st} locked={locked} onUnlock={() => setUnlocked(true)} />
      {/* Not set up: no IP and no demo. (The demo needs no address.) */}
      {!setup.host.trim() && !setup.demo ? (
        <span style={{ fontSize: 13, color: "var(--dim)" }}>{t("audac.notSetUp")}</span>
      ) : (
        <div className="scroll" style={{ display: "flex", flexDirection: "column", gap: big ? 8 : 4, opacity: live ? 1 : 0.5, pointerEvents: live ? "auto" : "none", minHeight: 0 }}>
          {zones.map((z) => (
            <ZoneRow key={z.n} n={z.n} name={z.name} zone={st?.zones[z.n - 1]} inputs={inputs} big={big} />
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBar({ st, locked, onUnlock }: { st: AudacState | null; locked: boolean; onUnlock: () => void }) {
  const t = useT();
  const status = st?.status ?? "off";
  const color = status === "connected" ? "var(--acc)" : status === "off" ? "var(--mute)" : "var(--amb)";
  const text =
    status === "connected" ? `${t("audac.connected")} ${st!.host}` :
    status === "connecting" ? t("audac.connecting") :
    status === "retrying" ? (st?.message ?? t("audac.retrying")) :
    t("audac.off");
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ width: 9, height: 9, borderRadius: 5, flex: "none", background: color }} />
      <span className="clamp1" title={text} style={{ flex: 1, fontSize: 12.5, color: status === "retrying" ? "var(--ambtx)" : "var(--dim)" }}>{text}</span>
      {locked ? (
        <button className="b btn" tabIndex={-1} onClick={onUnlock} title={t("audac.lockedHint")} style={{ height: 28, fontSize: 12 }}>{t("audac.unlock")}</button>
      ) : status === "off" ? (
        <button className="b btn" tabIndex={-1} onClick={audacConnectSaved} style={{ height: 28, fontSize: 12 }}>{t("audac.connect")}</button>
      ) : (
        // Letting go frees the MTX for the Touch 2 app.
        <button className="b btn btn-ghost" tabIndex={-1} onClick={() => void audac.disconnect()} title={t("audac.releaseHint")} style={{ height: 28, fontSize: 12 }}>{t("audac.release")}</button>
      )}
    </div>
  );
}

function ZoneRow({ n, name, zone, inputs, big }: {
  n: number;
  name: string;
  zone: { volume: number; input: number; mute: boolean } | undefined;
  inputs: { n: number; name: string }[];
  big: boolean;
}) {
  const t = useT();
  const volume = zone?.volume ?? MIN_VOLUME;
  // While dragging, show the slider's own value; the MTX's answer follows a moment later.
  const [drag, setDrag] = useState<number | null>(null);
  useEffect(() => setDrag(null), [volume]);
  const shown = drag ?? volume;
  const h = big ? 34 : 28;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: big ? "10px 12px" : "6px 8px", borderRadius: 10, background: "var(--p2)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span className="clamp1" style={{ flex: 1, fontWeight: 700, fontSize: big ? 15 : 13 }}>{name}</span>
        <span className="mono" style={{ width: 62, textAlign: "right", fontSize: 12.5, color: zone?.mute ? "var(--redtx)" : "var(--text)" }}>
          {zone?.mute ? "MUTE" : shown >= MIN_VOLUME ? "off" : `−${shown} dB`}
        </span>
        <button className="b btn" tabIndex={-1} aria-label={`${name}: ${t("audac.down")}`} onClick={() => void audac.step(n, false)} style={{ height: h, width: h, justifyContent: "center", padding: 0 }}>−</button>
        <button className="b btn" tabIndex={-1} aria-label={`${name}: ${t("audac.up")}`} onClick={() => void audac.step(n, true)} style={{ height: h, width: h, justifyContent: "center", padding: 0 }}>+</button>
        <button className="b chip" tabIndex={-1} aria-pressed={!!zone?.mute} onClick={() => void audac.setMute(n, !zone?.mute)}
          style={{ height: h, background: zone?.mute ? "var(--red)" : undefined, color: zone?.mute ? "var(--onred)" : undefined }}>
          {t("audac.mute")}
        </button>
      </div>
      {/* Right = louder. The MTX counts dB below maximum, so the slider is turned around. */}
      <input type="range" tabIndex={-1} aria-label={`${name} volume`} min={0} max={MIN_VOLUME} step={1} value={MIN_VOLUME - shown}
        onChange={(e) => {
          const db = MIN_VOLUME - Number(e.target.value);
          setDrag(db);
          void audac.setVolume(n, db);
        }} />
      <div role="group" aria-label={`${name} input`} style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {inputs.map((i) => (
          <button key={i.n} className="b chip" tabIndex={-1} aria-pressed={zone?.input === i.n} onClick={() => void audac.setInput(n, i.n)}
            style={{ height: big ? 30 : 24, fontSize: big ? 12.5 : 11.5, padding: "0 8px" }}>
            {i.name}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Top bar button (Build / Preflight); opens the panel in a window. Only shown when an MTX is set up. */
export function AudacButton() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const st = useAudac();
  const on = st?.status === "connected";
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button className="b btn" onClick={() => setOpen(true)} title={t("audac.title")} style={{ fontWeight: 700 }}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: on ? "var(--acc)" : st?.status === "retrying" ? "var(--amb)" : "var(--mute)" }} />
        AUDAC
      </button>
      {open && (
        <div className="scrim" style={{ position: "fixed", zIndex: 66 }} onClick={() => setOpen(false)}>
          <div className="dialog" role="dialog" aria-label={t("audac.title")} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620, maxHeight: "90%", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 18, fontWeight: 800, flex: 1 }}>{t("audac.title")}</span>
              <button className="b btn btn-ghost" onClick={() => { setOpen(false); useUi.getState().openDialog({ kind: "settings", tab: "audac" }); }}>{t("audac.setup")}</button>
              <button className="b btn btn-ghost" onClick={() => setOpen(false)}>{t("close")} · Esc</button>
            </div>
            <AudacPanel big />
          </div>
        </div>
      )}
    </>
  );
}
