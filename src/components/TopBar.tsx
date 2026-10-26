// The bar at the top of every screen: logo, show name (= File menu), mode switch, output, clock, meter,
// background player and settings (Build/Preflight) or the booth menu (Run).

import { useEffect, useState } from "react";
import { useDoc } from "../store";
import { useEngine } from "../engineStore";
import { useUi } from "../uiStore";
import { useSettings } from "../settingsStore";
import { enableDumbo } from "../lib/media";
import { ModeSwitch } from "./ModeSwitch";
import { MasterMeter } from "./MasterMeter";
import { Gear } from "./Icons";
import { FileMenuButton } from "./FileMenu";
import { BackgroundButton } from "./background/BackgroundPanel";
import { useT } from "../i18n";

export function TopBar({ preflightOk }: { preflightOk: boolean }) {
  const mode = useDoc((s) => s.mode);
  const t = useT();

  return (
    <header style={{ height: 56, flex: "none", display: "flex", alignItems: "center", gap: 14, padding: "0 16px", borderBottom: "1px solid var(--line)", background: "var(--bg)", position: "relative", zIndex: 30 }}>
      <span className="cond" style={{ fontSize: 22, fontWeight: 800, letterSpacing: ".06em", whiteSpace: "nowrap" }}>
        STAGE<span style={{ color: "var(--acc)" }}>GREMLIN</span>
      </span>
      <FileMenuButton />
      <ModeSwitch preflightOk={preflightOk} />
      <div style={{ flex: 1 }} />
      <OutputChip />
      <WallClock />
      <MasterMeter />
      <MasterFader />
      {/* Run has its own background dock and booth settings; Build and Preflight get the pill and the gear. */}
      {mode === "run" ? (
        <BoothMenu />
      ) : (
        <>
          <BackgroundButton />
          <button className="b btn btn-icon" onClick={() => useUi.getState().openDialog({ kind: "settings" })} aria-label={t("top.settings")} title={t("top.settings")} style={{ width: 36, height: 36, background: "var(--p2)" }}>
            <Gear />
          </button>
        </>
      )}
    </header>
  );
}

function OutputChip() {
  const output = useEngine((s) => s.output);
  const found = output?.outputFound ?? false;
  return (
    <span
      className="mono clamp1"
      title={output ? `Playing on ${output.outputName}` : "Waiting for the engine"}
      style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 600, padding: "5px 9px", borderRadius: 6, background: found ? "var(--p2)" : "var(--redbg)", color: found ? "var(--dim)" : "var(--redtx)", maxWidth: 220 }}
    >
      <span style={{ width: 8, height: 8, borderRadius: 4, flex: "none", background: output ? (found ? "var(--acc)" : "var(--red)") : "var(--mute)" }} />
      {output ? (found ? output.outputName : "OUTPUT MISSING") : "NO ENGINE"}
    </span>
  );
}

function WallClock() {
  const t = useT();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
      <span className="k">{t("top.time")}</span>
      <span className="mono" style={{ fontSize: 15, fontWeight: 600 }}>
        {now.toLocaleTimeString("nl-BE", { hour: "2-digit", minute: "2-digit" })}
      </span>
    </div>
  );
}

/**
 * The show's master fader (−60 … +10 dB, 0 = unity). Works in Run too: riding the overall
 * level is part of running the show. One drag = one undo step. Double-click resets to 0 dB.
 */
function MasterFader() {
  const db = useDoc((s) => s.show.settings.masterDb ?? 0);
  const set = (v: number) =>
    useDoc.getState().edit((s) => ({ ...s, settings: { ...s.settings, masterDb: v } }), { coalesce: "master-fader", allowInRun: true });
  return (
    <div title="Master level (double-click: 0 dB)" style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input
        type="range" aria-label="Master level" min={-60} max={10} step={0.5} value={db} tabIndex={-1}
        onChange={(e) => set(Number(e.target.value))}
        onDoubleClick={() => set(0)}
        // A vertical fader, like on the desk.
        style={{ writingMode: "vertical-lr", direction: "rtl", width: 16, height: 44, margin: 0 }}
      />
      <span style={{ display: "flex", flexDirection: "column", width: 46 }}>
        <span className="k" style={{ fontSize: 9.5 }}>Master</span>
        <span className="mono" style={{ fontSize: 11, color: db > 0 ? "var(--amb)" : db < 0 ? "var(--dim)" : "var(--text)" }}>
          {db === 0 ? "0 dB" : `${db > 0 ? "+" : "−"}${Math.abs(db).toFixed(1)}`}
        </span>
      </span>
    </div>
  );
}

/** Booth settings for a dark hall: dimmer, red night mode, Big mode. */
function BoothMenu() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const booth = useUi((s) => s.booth);
  const setBooth = useUi((s) => s.setBooth);
  const active = booth.dim < 100 || booth.red || booth.big;
  return (
    <div style={{ position: "relative" }}>
      <button className="b btn mono" tabIndex={-1} onClick={() => setOpen(!open)} aria-expanded={open}
        style={{ height: 36, background: active ? "var(--ambbg)" : "var(--p2)", color: active ? "var(--ambtx)" : "var(--text)", fontSize: 12, fontWeight: 700 }}>
        {t("top.booth")}
      </button>
      {open && (
        <div role="dialog" aria-label="Booth settings" style={{ position: "absolute", right: 0, top: 44, width: 300, background: "var(--p1)", border: "1px solid var(--line)", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 12, boxShadow: "0 16px 40px rgba(0,0,0,.35)", zIndex: 40 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="k">Brightness · {booth.dim}%</span>
            <input type="range" min={35} max={100} value={booth.dim} onChange={(e) => setBooth({ dim: Number(e.target.value) })} />
          </label>
          <button className="b chip" aria-pressed={booth.red} onClick={() => setBooth({ red: !booth.red })} style={{ height: 36 }}>Red night mode {booth.red ? "on" : "off"} · Ctrl+Shift+R</button>
          <button className="b chip" aria-pressed={booth.big} onClick={() => setBooth({ big: !booth.big })} style={{ height: 36 }}>Big mode {booth.big ? "on" : "off"} · Ctrl+B</button>
          <button className="b chip" onClick={() => { setOpen(false); enableDumbo(); }} style={{ height: 36 }}>
            {useSettings.getState().ui.lang === "nl" ? "Dumbo-modus aanzetten" : "Turn on Dumbo mode"}
          </button>
          <span style={{ fontSize: 12, color: "var(--mute)" }}>Big mode shows only GO, what's playing and what's next (in Run). Ctrl+T cycles the theme.</span>
        </div>
      )}
    </div>
  );
}

/** Red banner under the top bar when the chosen output (the Qu-24) disappeared. */
export function OutputBanner() {
  const output = useEngine((s) => s.output);
  if (!output || output.outputFound) return null;
  return (
    <div role="alert" style={{ flex: "none", padding: "8px 18px", background: "var(--red)", color: "var(--onred)", fontSize: 14, fontWeight: 700 }}>
      {output.preferred ?? "The chosen output"} not found — playing on {output.outputName}
    </div>
  );
}
