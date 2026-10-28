// Settings › THIS LAPTOP: output devices, Run & booth (Dumbo mode), language & look, shortcuts.
// Remembered per machine (settingsStore / booth in uiStore), except the limiter ceiling, which is
// saved in the show so the hall's limit travels with it.

import { useEffect, useState } from "react";
import { useDoc } from "../../store";
import { useUi } from "../../uiStore";
import { ACTIONS, conflictsFor, keyFor, keyName, useSettings, type Action } from "../../settingsStore";
import { useT, type Lang, type TKey } from "../../i18n";
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
      <Card title={t("s.aud.ceiling")} note={t("s.aud.ceilingNote")}>
        <Row label={t("s.aud.ceilingRow")}>
          <NumField label={t("s.aud.ceiling")} unit="dBTP" value={settings.limiterCeilingDb} min={-12} max={0} step={0.5} onChange={(v) => set({ limiterCeilingDb: v })} />
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
          <span style={{ fontSize: 20, fontWeight: 800 }}>{t("s.run.dumbo")}</span>
          <span style={{ fontSize: 14, color: "#C9CBBE", lineHeight: 1.5 }}>{t("set.dumboText")}</span>
        </div>
        <button className="b" aria-pressed={ui.dumbo} onClick={() => (ui.dumbo ? update({ dumbo: false }) : enableDumbo())}
          style={{ width: 96, height: 48, borderRadius: 12, fontSize: 16, fontWeight: 800, letterSpacing: ".06em", background: ui.dumbo ? "#B8EA2A" : "#2A2C24", color: ui.dumbo ? "#172000" : "#F4F3EE" }}>
          {ui.dumbo ? t("s.onTag") : t("s.offTag")}
        </button>
      </section>
      <Card>
        <Row label={t("s.run.pads")}><button className="b chip" aria-pressed={ui.dumboPads} onClick={() => update({ dumboPads: !ui.dumboPads })}>{ui.dumboPads ? t("s.run.padsOn") : t("s.run.padsOff")}</button></Row>
        <Row label={t("s.run.pin")} hint={t("s.run.pinHint")}>
          <input className="input mono" aria-label={t("s.run.pinLabel")} inputMode="numeric" maxLength={4} placeholder={t("s.run.pinNone")} value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            onBlur={() => update({ dumboPin: pin.length === 4 ? pin : "" })} style={{ width: 90, letterSpacing: ".3em", textAlign: "center" }} />
          {pin.length > 0 && pin.length < 4 && <span style={{ fontSize: 12, color: "var(--amb)" }}>{t("s.run.pin4")}</span>}
        </Row>
      </Card>
      <Card title={t("s.booth")} note={t("s.booth.note")}>
        <Row label={t("s.booth.bg")}>
          <button className="b chip" aria-pressed={ui.bgLockDefault} onClick={() => update({ bgLockDefault: !ui.bgLockDefault })}>
            {ui.bgLockDefault ? t("s.booth.bgLocked") : t("s.booth.bgUnlocked")}
          </button>
        </Row>
        <Row label={t("s.booth.brightness")}><Slider label={t("s.booth.brightness")} min={35} max={100} step={5} value={booth.dim} format={(v) => `${v}%`} onChange={(dim) => setBooth({ dim })} /></Row>
        <Row label={t("s.booth.red")}><button className="b chip" aria-pressed={booth.red} onClick={() => setBooth({ red: !booth.red })}>{booth.red ? t("sched.on") : t("sched.off")} · {keyFor("redMode")}</button></Row>
        <Row label={t("s.booth.big")} hint={t("s.booth.bigHint")}><button className="b chip" aria-pressed={booth.big} onClick={() => setBooth({ big: !booth.big })}>{booth.big ? t("sched.on") : t("sched.off")} · {keyFor("bigMode")}</button></Row>
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
        <Row label={t("s.look.lang")}>
          <Chips<Lang> label={t("s.look.lang")} value={ui.lang} onChange={(lang) => update({ lang })} options={[{ value: "en", label: "English" }, { value: "nl", label: "Nederlands" }]} />
        </Row>
        <Row label={t("s.look.theme")} hint={t("s.look.themeHint", { key: keyFor("theme") })}>
          <Chips label={t("s.look.theme")} value={themePref} onChange={setTheme}
            options={[{ value: "auto", label: t("s.look.auto") }, { value: "light", label: t("s.look.light") }, { value: "oled", label: t("s.look.oled") }]} />
        </Row>
        <Row label={t("s.look.files")}>
          <Chips label={t("s.look.fileDisplay")} value={fileDisplay} onChange={(v) => v !== fileDisplay && useDoc.getState().toggleFileDisplay()}
            options={[{ value: "name", label: t("s.look.fileName") }, { value: "path", label: t("s.look.fullPath") }]} />
        </Row>
        <Row label={t("s.look.size")}>
          <Slider label={t("s.look.size")} min={90} max={130} step={5} value={ui.zoom} format={(v) => `${v}%`} onChange={(zoom) => update({ zoom })} />
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
        <PageTitle note={t("s.keys.note")}>{t("set.shortcuts")}</PageTitle>
        <span style={{ flex: 1 }} />
        <button className="b btn" onClick={() => update({ keys: {} })} disabled={!Object.keys(ui.keys).length}>{t("s.keys.reset")}</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", border: "1px solid var(--line)", borderRadius: 14, overflow: "hidden", background: "var(--p1)" }}>
        {(Object.keys(ACTIONS) as Action[]).map((a, i) => {
          const key = keyFor(a);
          const clash = conflictsFor(a, key);
          const changed = ui.keys[a] !== undefined;
          return (
            <div key={a} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 120px 160px", gap: 10, alignItems: "center", padding: "6px 14px", borderTop: i ? "1px solid var(--line)" : "none" }}>
              <span style={{ fontSize: 14 }}>
                {t(ACTION_LABEL[a])}
                {clash.length > 0 && <span style={{ color: "var(--redtx)", fontSize: 12 }}>{t("s.keys.same", { list: clash.map((c) => t(ACTION_LABEL[c])).join(", ") })}</span>}
              </span>
              <span style={{ fontSize: 12, color: "var(--mute)" }}>{t(WHERE_LABEL[ACTIONS[a].where])}</span>
              <button className="b btn mono" data-listening={listening === a ? "" : undefined} onClick={() => setListening(a)}
                style={{ height: 30, justifyContent: "center", background: listening === a ? "var(--amb)" : clash.length ? "var(--redbg)" : "var(--p3)", color: listening === a ? "var(--onamb)" : clash.length ? "var(--redtx)" : "var(--text)", fontWeight: changed ? 700 : 400 }}>
                {listening === a ? t("s.keys.press") : key}
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** Each shortcut's name, as a translation key (ACTIONS in settingsStore has the English). */
const ACTION_LABEL: Record<Action, TKey> = {
  go: "s.act.go", goAlt: "s.act.goAlt", stopAll: "s.act.stopAll", stopCue: "s.act.stopCue",
  under: "s.act.under", releaseVamp: "s.act.releaseVamp", find: "s.act.find", preview: "s.act.preview",
  modeBuild: "s.act.modeBuild", modePreflight: "s.act.modePreflight", modeRun: "s.act.modeRun", modeBackground: "s.act.modeBackground",
  save: "s.act.save", saveAs: "s.act.saveAs", open: "s.act.open", newShow: "s.act.newShow",
  importAudio: "s.act.importAudio", youtube: "s.act.youtube", undo: "s.act.undo", redo: "s.act.redo",
  print: "s.act.print", bigMode: "s.act.bigMode", theme: "s.act.theme", redMode: "s.act.redMode",
  pauseAll: "s.act.pauseAll", bgDuck: "s.act.bgDuck", bgRestore: "s.act.bgRestore", bgPlayPause: "s.act.bgPlayPause",
  bgNext: "s.act.bgNext", settings: "s.act.settings", cut: "s.act.cut", copy: "s.act.copy",
  paste: "s.act.paste", duplicate: "s.act.duplicate",
};

/** Where a shortcut works (ACTIONS[...].where), as a translation key. */
const WHERE_LABEL: Record<(typeof ACTIONS)[Action]["where"], TKey> = {
  Run: "s.where.run", "Build, Run": "s.where.buildRun", Everywhere: "s.where.everywhere", Build: "s.where.build", "Build, Preflight": "s.where.buildPreflight",
};
