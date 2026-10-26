// Settings (gear in the top bar; not offered in Run): display, language, shortcuts, safety.

import { useEffect, useState } from "react";
import { useDoc } from "../store";
import { useUi } from "../uiStore";
import { ACTIONS, conflictsFor, keyFor, keyName, useSettings, type Action } from "../settingsStore";
import { useT, type Lang } from "../i18n";
import { Chips, NumField, Row } from "./controls";

export function SettingsDialog() {
  const close = useUi((s) => s.closeDialog);
  const t = useT();
  const ui = useSettings((s) => s.ui);
  const update = useSettings((s) => s.update);
  const themePref = useDoc((s) => s.themePref);
  const fileDisplay = useDoc((s) => s.fileDisplay);
  const doubleGoMs = useDoc((s) => s.show.settings.doubleGoMs);
  const [listening, setListening] = useState<Action | null>(null);

  // While "listening", the next key press becomes the new shortcut (Esc cancels).
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

  const setTheme = (want: typeof themePref) => {
    // The store only cycles; step until it lands on the wanted value (at most two steps).
    for (let i = 0; i < 3 && useDoc.getState().themePref !== want; i++) useDoc.getState().cycleTheme();
  };

  return (
    <div className="scrim" style={{ padding: "40px 24px", zIndex: 66 }}>
      <div role="dialog" aria-label={t("top.settings")} className="dialog scroll" style={{ maxWidth: 760, maxHeight: "100%" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <span className="cond" style={{ fontSize: 26, fontWeight: 800, flex: 1 }}>{t("top.settings")}</span>
          <button className="b btn btn-go" onClick={close}>{t("done")}</button>
        </div>

        <span className="k">Display</span>
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

        <span className="k" style={{ marginTop: 6 }}>Safety</span>
        <Row label="Double GO" hint="A second GO within this time is ignored (a nervous double tap). Saved with the show.">
          <NumField label="Double-GO guard" unit="ms (saved with this show)" value={doubleGoMs} min={0} max={2000} step={50} digits={0}
            onChange={(v) => useDoc.getState().edit((s) => ({ ...s, settings: { ...s.settings, doubleGoMs: Math.round(v) } }))} />
        </Row>
        <Row label="Background">
          <button className="b chip" aria-pressed={ui.bgLockDefault} onClick={() => update({ bgLockDefault: !ui.bgLockDefault })}>
            {ui.bgLockDefault ? "Locked when Run starts" : "Unlocked when Run starts"}
          </button>
        </Row>

        <div style={{ display: "flex", alignItems: "center", marginTop: 6 }}>
          <span className="k" style={{ flex: 1 }}>Shortcuts · click one, then press the new key</span>
          <button className="b btn" onClick={() => update({ keys: {} })} disabled={!Object.keys(ui.keys).length}>Reset to defaults</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
          {(Object.keys(ACTIONS) as Action[]).map((a) => {
            const key = keyFor(a);
            const clash = conflictsFor(a, key);
            const changed = ui.keys[a] !== undefined;
            return (
              <div key={a} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 110px 150px", gap: 10, alignItems: "center", padding: "6px 12px", borderTop: "1px solid var(--line)" }}>
                <span style={{ fontSize: 14 }}>
                  {ACTIONS[a].label}
                  {clash.length > 0 && <span style={{ color: "var(--redtx)", fontSize: 12 }}> · same key as {clash.map((c) => ACTIONS[c].label).join(", ")}</span>}
                </span>
                <span style={{ fontSize: 12, color: "var(--mute)" }}>{ACTIONS[a].where}</span>
                <button className="b btn mono" onClick={() => setListening(a)}
                  style={{ height: 30, justifyContent: "center", background: listening === a ? "var(--amb)" : clash.length ? "var(--redbg)" : "var(--p3)", color: listening === a ? "var(--onamb)" : clash.length ? "var(--redtx)" : "var(--text)", fontWeight: changed ? 700 : 400 }}>
                  {listening === a ? "press a key…" : key}
                </button>
              </div>
            );
          })}
        </div>
        <span style={{ fontSize: 12, color: "var(--mute)" }}>Pads always use 1–9 and 0. Esc twice is always Panic.</span>
      </div>
    </div>
  );
}
