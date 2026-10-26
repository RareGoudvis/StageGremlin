// Settings (gear in the top bar or Ctrl+, — not offered in Run). A full-height panel with tabs:
// Audio · Show · Background · YouTube & tools · Display · Shortcuts · About.
// Per-machine settings go to settingsStore (settings_set); show settings are saved in the show file.

import { useEffect, useState, type ReactNode } from "react";
import { useDoc } from "../store";
import { useUi } from "../uiStore";
import { ACTIONS, conflictsFor, keyFor, keyName, useSettings, type Action } from "../settingsStore";
import { useT, type Lang } from "../i18n";
import type { ShowSettings } from "../types";
import { call } from "../lib/tauri";
import { hasTool, TOOL_NAME, useTools } from "../lib/tools";
import { fmtDb } from "../lib/format";
import { Chips, NumField, Row, Slider } from "./controls";
import { CalibrationCard, OutputPicker } from "../views/PreflightView";
import { BackgroundSettings } from "./background/BackgroundPanel";
import { enableDumbo } from "../lib/media";

type Tab = "audio" | "show" | "background" | "tools" | "display" | "shortcuts" | "about";

const TABS: { id: Tab; label: string; nl: string }[] = [
  { id: "audio", label: "Audio", nl: "Audio" },
  { id: "show", label: "Show", nl: "Show" },
  { id: "background", label: "Background", nl: "Achtergrond" },
  { id: "tools", label: "YouTube & tools", nl: "YouTube & tools" },
  { id: "display", label: "Display", nl: "Weergave" },
  { id: "shortcuts", label: "Shortcuts", nl: "Sneltoetsen" },
  { id: "about", label: "About", nl: "Over" },
];

let lastTab: Tab = "audio";

export function SettingsDialog() {
  const close = useUi((s) => s.closeDialog);
  const t = useT();
  const lang = useSettings((s) => s.ui.lang);
  // Opened with a page in mind (Add window › Import settings…), else the page used last.
  const asked = useUi((s) => (s.dialog?.kind === "settings" ? s.dialog.tab : undefined));
  const [tab, setTabState] = useState<Tab>(TABS.some((x) => x.id === asked) ? (asked as Tab) : lastTab);
  const setTab = (x: Tab) => { lastTab = x; setTabState(x); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target as HTMLElement).closest("input, textarea, select") && !document.querySelector("[data-listening]")) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  return (
    <div className="scrim" style={{ padding: 0, zIndex: 66, justifyContent: "flex-end", alignItems: "stretch" }} onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-label={t("top.settings")} style={{ width: "min(1040px, 100%)", height: "100%", background: "var(--bg)", borderLeft: "1px solid var(--line)", display: "grid", gridTemplateColumns: "200px minmax(0, 1fr)", gridTemplateRows: "auto minmax(0, 1fr)" }}>
        <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", padding: "14px 18px", borderBottom: "1px solid var(--line)" }}>
          <span className="cond" style={{ fontSize: 26, fontWeight: 800, flex: 1 }}>{t("top.settings")}</span>
          <button className="b btn btn-go" onClick={close}>{t("done")} · Esc</button>
        </div>
        <nav role="tablist" aria-orientation="vertical" style={{ borderRight: "1px solid var(--line)", padding: 10, display: "flex", flexDirection: "column", gap: 2, background: "var(--p1)" }}>
          {TABS.map((x) => (
            <button key={x.id} role="tab" aria-selected={tab === x.id} className="b" onClick={() => setTab(x.id)}
              style={{ textAlign: "left", height: 36, padding: "0 12px", borderRadius: 8, fontSize: 14, fontWeight: 700, background: tab === x.id ? "var(--hl)" : "transparent", color: tab === x.id ? "var(--bg)" : "var(--text)" }}>
              {lang === "nl" ? x.nl : x.label}
            </button>
          ))}
        </nav>
        <div className="scroll" style={{ padding: "18px 24px 40px", display: "flex", flexDirection: "column", gap: 14, minHeight: 0 }}>
          {tab === "audio" && <AudioTab />}
          {tab === "show" && <ShowTab />}
          {tab === "background" && <BackgroundTab />}
          {tab === "tools" && <ToolsTab />}
          {tab === "display" && <DisplayTab />}
          {tab === "shortcuts" && <ShortcutsTab />}
          {tab === "about" && <AboutTab />}
        </div>
      </div>
    </div>
  );
}

function H({ children, note }: { children: ReactNode; note?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 4 }}>
      <span className="k">{children}</span>
      {note && <span style={{ fontSize: 12.5, color: "var(--mute)" }}>{note}</span>}
    </div>
  );
}

/** Edit one field of show.settings (saved with the show file). */
function useShowSetting() {
  const settings = useDoc((s) => s.show.settings);
  const set = (patch: Partial<ShowSettings>, key?: string) =>
    useDoc.getState().edit((s) => ({ ...s, settings: { ...s.settings, ...patch } }), key ? { coalesce: `settings:${key}` } : undefined);
  return { settings, set };
}

// ---------------------------------------------------------------- Audio

function AudioTab() {
  const { settings, set } = useShowSetting();
  return (
    <>
      <OutputPicker />
      <OutputPicker preview />
      <CalibrationCard />
      <H note="Saved with the show. The fader is also in the top bar.">Master</H>
      <Row label="Master fader">
        <Slider label="Master level" min={-60} max={10} step={0.5} value={settings.masterDb ?? 0} format={(v) => fmtDb(v)} onChange={(v) => set({ masterDb: v }, "master")} />
      </Row>
      <Row label="Limiter ceiling" hint="Nothing leaves the laptop louder than this (true peak).">
        <NumField label="Limiter ceiling" unit="dBTP" value={settings.limiterCeilingDb} min={-12} max={0} step={0.5} onChange={(v) => set({ limiterCeilingDb: v })} />
      </Row>
    </>
  );
}

// ---------------------------------------------------------------- Show

function ShowTab() {
  const { settings, set } = useShowSetting();
  return (
    <>
      <H note="These are saved in the show file, so they travel with the show to another laptop.">Loudness</H>
      <Row label="Target" hint="Every cue is matched to this loudness."><NumField label="Loudness target" unit="LUFS" value={settings.targetLufs} min={-30} max={-6} step={0.5} onChange={(v) => set({ targetLufs: v })} /></Row>
      <Row label="Peak ceiling" hint="Matching never boosts a cue's loudest peak above this."><NumField label="Peak ceiling" unit="dBTP" value={settings.peakCeilingDb} min={-12} max={0} step={0.5} onChange={(v) => set({ peakCeilingDb: v })} /></Row>
      <H>Stopping and riding</H>
      <Row label="Stop all fade"><NumField label="Stop all fade" unit="s" value={settings.stopAllFade} min={0} max={10} onChange={(v) => set({ stopAllFade: v })} /></Row>
      <Row label="Under level" hint="Where U drops a cue (cues can have their own)."><NumField label="Under level" unit="dB" value={settings.underDb} min={-40} max={0} step={1} digits={0} onChange={(v) => set({ underDb: v })} /></Row>
      <Row label="Under fade"><NumField label="Under fade" unit="s" value={settings.underFade} min={0} max={5} onChange={(v) => set({ underFade: v })} /></Row>
      <H>Safety</H>
      <Row label="Double GO" hint="A second GO within this time is ignored (a nervous double tap).">
        <NumField label="Double-GO guard" unit="ms" value={settings.doubleGoMs} min={0} max={2000} step={50} digits={0} onChange={(v) => set({ doubleGoMs: Math.round(v) })} />
      </Row>
    </>
  );
}

// ---------------------------------------------------------------- Background

function BackgroundTab() {
  const ui = useSettings((s) => s.ui);
  const update = useSettings((s) => s.update);
  return (
    <>
      <BackgroundSettings />
      <H>On this laptop</H>
      <Row label="In Run">
        <button className="b chip" aria-pressed={ui.bgLockDefault} onClick={() => update({ bgLockDefault: !ui.bgLockDefault })}>
          {ui.bgLockDefault ? "Background starts locked" : "Background starts unlocked"}
        </button>
      </Row>
    </>
  );
}

// ---------------------------------------------------------------- YouTube & tools

function ToolsTab() {
  const status = useTools((s) => s.status);
  const installing = useTools((s) => s.installing);
  const ui = useSettings((s) => s.ui);
  const update = useSettings((s) => s.update);
  useEffect(() => void useTools.getState().refresh(), []);
  const tool = (what: "ytDlp" | "ffmpeg", detail: string) => {
    const have = hasTool(status, what);
    const pct = installing[what];
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, borderRadius: 10, border: "1px solid var(--line)", background: "var(--p1)" }}>
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
      <H note="Nothing is bundled with the app: these are downloaded on request into the app's data folder.">Tools</H>
      {tool("ytDlp", "Downloads audio from YouTube. YouTube changes often: update it before a show.")}
      {tool("ffmpeg", "Only needed for MP3/WAV downloads and for converting opus/webm files.")}
      {status && <span className="mono" style={{ fontSize: 12, color: "var(--mute)" }}>Folder: {status.binDir}</span>}
      <H>YouTube downloads</H>
      <Row label="Default format">
        <Chips<"original" | "mp3" | "wav"> label="Default download format" value={ui.ytFormat} onChange={(ytFormat) => update({ ytFormat })}
          options={[{ value: "original", label: "Original (m4a)" }, { value: "mp3", label: "MP3" }, { value: "wav", label: "WAV" }]} />
      </Row>
    </>
  );
}

// ---------------------------------------------------------------- Display

function DisplayTab() {
  const ui = useSettings((s) => s.ui);
  const update = useSettings((s) => s.update);
  const themePref = useDoc((s) => s.themePref);
  const fileDisplay = useDoc((s) => s.fileDisplay);
  const booth = useUi((s) => s.booth);
  const setBooth = useUi((s) => s.setBooth);
  const [pin, setPin] = useState(ui.dumboPin);
  const setTheme = (want: typeof themePref) => {
    // The store only cycles; step until it lands on the wanted value (at most two steps).
    for (let i = 0; i < 3 && useDoc.getState().themePref !== want; i++) useDoc.getState().cycleTheme();
  };
  return (
    <>
      <H>Look</H>
      <Row label="Language">
        <Chips<Lang> label="Language" value={ui.lang} onChange={(lang) => update({ lang })} options={[{ value: "en", label: "English" }, { value: "nl", label: "Nederlands" }]} />
      </Row>
      <Row label="Theme">
        <Chips label="Theme" value={themePref} onChange={setTheme}
          options={[{ value: "auto", label: "Auto (light Build, black Run)" }, { value: "light", label: "Light" }, { value: "oled", label: "OLED black" }]} />
      </Row>
      <Row label="Files show">
        <Chips label="File display" value={fileDisplay} onChange={(v) => v !== fileDisplay && useDoc.getState().toggleFileDisplay()}
          options={[{ value: "name", label: "File name" }, { value: "path", label: "Full path" }]} />
      </Row>
      <Row label="UI size">
        <Slider label="UI size" min={90} max={130} step={5} value={ui.zoom} format={(v) => `${v}%`} onChange={(zoom) => update({ zoom })} />
      </Row>
      <H note="For a dark hall. Also in the BOOTH menu in the top bar.">Booth</H>
      <Row label="Brightness"><Slider label="Brightness" min={35} max={100} step={5} value={booth.dim} format={(v) => `${v}%`} onChange={(dim) => setBooth({ dim })} /></Row>
      <Row label="Red mode"><button className="b chip" aria-pressed={booth.red} onClick={() => setBooth({ red: !booth.red })}>{booth.red ? "On" : "Off"}</button></Row>
      <H note="A super-simple Run screen for someone who has never run sound: one huge GO, what plays, what's next, Stop all. Every other key is ignored.">Dumbo mode</H>
      <Row label="Dumbo mode">
        <button className="b chip" aria-pressed={ui.dumbo} onClick={() => (ui.dumbo ? update({ dumbo: false }) : enableDumbo())}>{ui.dumbo ? "On" : "Off"}</button>
      </Row>
      <Row label="Pads"><button className="b chip" aria-pressed={ui.dumboPads} onClick={() => update({ dumboPads: !ui.dumboPads })}>{ui.dumboPads ? "Show a row of pads" : "No pads"}</button></Row>
      <Row label="Leave with PIN" hint="Optional. Without a PIN, leaving means holding the corner button for 3 seconds.">
        <input className="input mono" aria-label="Dumbo mode PIN" inputMode="numeric" maxLength={4} placeholder="none" value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          onBlur={() => update({ dumboPin: pin.length === 4 ? pin : "" })} style={{ width: 90, letterSpacing: ".3em", textAlign: "center" }} />
        {pin.length > 0 && pin.length < 4 && <span style={{ fontSize: 12, color: "var(--amb)" }}>4 digits</span>}
      </Row>
    </>
  );
}

// ---------------------------------------------------------------- Shortcuts

function ShortcutsTab() {
  const ui = useSettings((s) => s.ui);
  const update = useSettings((s) => s.update);
  const [listening, setListening] = useState<Action | null>(null);

  // While "listening", the next key press becomes the new shortcut (Esc cancels, except for Stop all).
  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return; // wait for the real key
      if (e.key === "Escape" && listening !== "stopAll") { setListening(null); return; }
      update({ keys: { ...ui.keys, [listening]: keyName(e) } });
      setListening(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [listening, ui.keys, update]);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center" }}>
        <H note="Click a key, then press the new one. Pads always use 1–9 and 0; pressing Stop all twice is always Panic.">Shortcuts</H>
        <span style={{ flex: 1 }} />
        <button className="b btn" onClick={() => update({ keys: {} })} disabled={!Object.keys(ui.keys).length}>Reset to defaults</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
        {(Object.keys(ACTIONS) as Action[]).map((a) => {
          const key = keyFor(a);
          const clash = conflictsFor(a, key);
          const changed = ui.keys[a] !== undefined;
          return (
            <div key={a} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 120px 160px", gap: 10, alignItems: "center", padding: "6px 12px", borderTop: "1px solid var(--line)" }}>
              <span style={{ fontSize: 14 }}>
                {ACTIONS[a].label}
                {clash.length > 0 && <span style={{ color: "var(--redtx)", fontSize: 12 }}> · same key as {clash.map((c) => ACTIONS[c].label).join(", ")}</span>}
              </span>
              <span style={{ fontSize: 12, color: "var(--mute)" }}>{ACTIONS[a].where}</span>
              <button className="b btn mono" data-listening={listening === a ? "" : undefined} onClick={() => setListening(a)}
                style={{ height: 30, justifyContent: "center", background: listening === a ? "var(--amb)" : clash.length ? "var(--redbg)" : "var(--p3)", color: listening === a ? "var(--onamb)" : clash.length ? "var(--redtx)" : "var(--text)", fontWeight: changed ? 700 : 400 }}>
                {listening === a ? "press a key…" : key}
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- About

function AboutTab() {
  const [info, setInfo] = useState<{ version: string; portable: boolean; dataDir: string } | null>(null);
  useEffect(() => {
    call("app_info").then(setInfo, () => setInfo(null));
  }, []);
  return (
    <>
      <span className="cond" style={{ fontSize: 40, fontWeight: 800 }}>STAGEGREMLIN</span>
      <span style={{ fontSize: 15, color: "var(--dim)" }}>A cue player for school shows. Build → Preflight → Run.</span>
      <Row label="Version"><span className="mono">{info?.version ?? "…"}</span></Row>
      <Row label="Portable"><span>{info ? (info.portable ? "Yes: settings and data live next to the app" : "No: installed version") : "…"}</span></Row>
      <Row label="Data folder">
        <span className="mono" style={{ fontSize: 12.5, wordBreak: "break-all", userSelect: "text", flex: 1 }}>{info?.dataDir ?? "…"}</span>
        {info?.dataDir && <button className="b btn" onClick={() => void call("show_in_folder", { path: info.dataDir }).catch(() => {})}>Open</button>}
      </Row>
      <Row label="Licence"><span>AGPL-3.0</span></Row>
      <Row label="Source"><span className="mono" style={{ userSelect: "text" }}>github.com/RareGoudvis/StageGremlin</span></Row>
    </>
  );
}
