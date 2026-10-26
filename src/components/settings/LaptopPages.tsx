// Settings › THIS LAPTOP: output devices, Run & booth (Dumbo mode), language & look, shortcuts.
// Remembered per machine (settingsStore / booth in uiStore), except the limiter ceiling, which is
// saved in the show so the hall's limit travels with it.

import { useEffect, useState } from "react";
import { useDoc } from "../../store";
import { useUi } from "../../uiStore";
import { ACTIONS, conflictsFor, keyFor, keyName, useSettings, type Action } from "../../settingsStore";
import { useT, type Lang } from "../../i18n";
import { enableDumbo } from "../../lib/media";
import { Chips, NumField, Row, Slider } from "../controls";
import { CalibrationCard, OutputPicker } from "../../views/PreflightView";
import { Card, PageTitle, useShowSetting } from "./common";

export function AudioPage() {
  const t = useT();
  const { settings, set } = useShowSetting();
  return (
    <>
      <PageTitle note={t("set.storedLaptop")}>{t("set.audio")}</PageTitle>
      <OutputPicker />
      <OutputPicker preview />
      <CalibrationCard />
      <Card title="Limiter ceiling" note="Nothing leaves the laptop louder than this (true peak). Saved with the show.">
        <Row label="Ceiling">
          <NumField label="Limiter ceiling" unit="dBTP" value={settings.limiterCeilingDb} min={-12} max={0} step={0.5} onChange={(v) => set({ limiterCeilingDb: v })} />
        </Row>
      </Card>
    </>
  );
}

export function RunBoothPage() {
  const t = useT();
  const ui = useSettings((s) => s.ui);
  const update = useSettings((s) => s.update);
  const booth = useUi((s) => s.booth);
  const setBooth = useUi((s) => s.setBooth);
  const [pin, setPin] = useState(ui.dumboPin);
  return (
    <>
      <PageTitle note={t("set.storedLaptop")}>{t("set.run")}</PageTitle>
      {/* Dumbo mode is the big one: dark card, one switch. */}
      <section style={{ background: "#17180F", color: "#F4F3EE", borderRadius: 14, padding: 22, display: "flex", alignItems: "center", gap: 18 }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 20, fontWeight: 800 }}>Dumbo mode</span>
          <span style={{ fontSize: 14, color: "#C9CBBE", lineHeight: 1.5 }}>{t("set.dumboText")}</span>
        </div>
        <button className="b" aria-pressed={ui.dumbo} onClick={() => (ui.dumbo ? update({ dumbo: false }) : enableDumbo())}
          style={{ width: 96, height: 48, borderRadius: 12, fontSize: 16, fontWeight: 800, letterSpacing: ".06em", background: ui.dumbo ? "#B8EA2A" : "#2A2C24", color: ui.dumbo ? "#172000" : "#F4F3EE" }}>
          {ui.dumbo ? "ON" : "OFF"}
        </button>
      </section>
      <Card>
        <Row label="Pads"><button className="b chip" aria-pressed={ui.dumboPads} onClick={() => update({ dumboPads: !ui.dumboPads })}>{ui.dumboPads ? "Show a row of pads in Dumbo mode" : "No pads in Dumbo mode"}</button></Row>
        <Row label="Leave with PIN" hint="Optional. Without a PIN, leaving means holding the corner button for 3 seconds.">
          <input className="input mono" aria-label="Dumbo mode PIN" inputMode="numeric" maxLength={4} placeholder="none" value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            onBlur={() => update({ dumboPin: pin.length === 4 ? pin : "" })} style={{ width: 90, letterSpacing: ".3em", textAlign: "center" }} />
          {pin.length > 0 && pin.length < 4 && <span style={{ fontSize: 12, color: "var(--amb)" }}>4 digits</span>}
        </Row>
      </Card>
      <Card title="Booth" note="For a dark hall. Also in the BOOTH menu in Run.">
        <Row label="Background">
          <button className="b chip" aria-pressed={ui.bgLockDefault} onClick={() => update({ bgLockDefault: !ui.bgLockDefault })}>
            {ui.bgLockDefault ? "Background music starts locked in Run" : "Background music starts unlocked in Run"}
          </button>
        </Row>
        <Row label="Brightness"><Slider label="Brightness" min={35} max={100} step={5} value={booth.dim} format={(v) => `${v}%`} onChange={(dim) => setBooth({ dim })} /></Row>
        <Row label="Red mode"><button className="b chip" aria-pressed={booth.red} onClick={() => setBooth({ red: !booth.red })}>{booth.red ? "On" : "Off"} · {keyFor("redMode")}</button></Row>
        <Row label="Big mode" hint="Run shows only GO, what's playing and what's next."><button className="b chip" aria-pressed={booth.big} onClick={() => setBooth({ big: !booth.big })}>{booth.big ? "On" : "Off"} · {keyFor("bigMode")}</button></Row>
      </Card>
    </>
  );
}

export function LookPage() {
  const t = useT();
  const ui = useSettings((s) => s.ui);
  const update = useSettings((s) => s.update);
  const themePref = useDoc((s) => s.themePref);
  const fileDisplay = useDoc((s) => s.fileDisplay);
  const setTheme = (want: typeof themePref) => {
    // The store only cycles; step until it lands on the wanted value (at most two steps).
    for (let i = 0; i < 3 && useDoc.getState().themePref !== want; i++) useDoc.getState().cycleTheme();
  };
  return (
    <>
      <PageTitle note={t("set.storedLaptop")}>{t("set.look")}</PageTitle>
      <Card>
        <Row label="Language">
          <Chips<Lang> label="Language" value={ui.lang} onChange={(lang) => update({ lang })} options={[{ value: "en", label: "English" }, { value: "nl", label: "Nederlands" }]} />
        </Row>
        <Row label="Theme" hint={`${keyFor("theme")} cycles the theme anywhere.`}>
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
      </Card>
    </>
  );
}

export function ShortcutsPage() {
  const t = useT();
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
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
        <PageTitle note="Click a key, then press the new one. Pads always use 1–9 and 0; pressing Stop all twice is always Panic.">{t("set.shortcuts")}</PageTitle>
        <span style={{ flex: 1 }} />
        <button className="b btn" onClick={() => update({ keys: {} })} disabled={!Object.keys(ui.keys).length}>Reset to defaults</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", border: "1px solid var(--line)", borderRadius: 14, overflow: "hidden", background: "var(--p1)" }}>
        {(Object.keys(ACTIONS) as Action[]).map((a, i) => {
          const key = keyFor(a);
          const clash = conflictsFor(a, key);
          const changed = ui.keys[a] !== undefined;
          return (
            <div key={a} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 120px 160px", gap: 10, alignItems: "center", padding: "6px 14px", borderTop: i ? "1px solid var(--line)" : "none" }}>
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
