// Right-hand panel in Build: every setting of the selected cue — or of the selected
// pad's cue (pads use the same sound chain, so the same panel edits them).
// One cue: tabs Basics · Sound · Timing · Notes (see inspector/). Several cues: the shared settings.
// Each control calls `set(patch, key)`; the key merges rapid changes (typing, sliders) into one undo step.

import { useEffect, useState, type ReactNode } from "react";
import { useDoc } from "../../store";
import type { Cue, Follow, Pad } from "../../types";
import { allCues, goQueue } from "../../types";
import { findCue, PAD_KEYS, PAD_MODES, removeCues, removePad, updateAnyCue, updatePad } from "../../lib/showOps";
import { ensureWaveform } from "../../lib/fileActions";
import { fmtDb } from "../../lib/format";
import { previewToggle, usePreview } from "../../lib/preview";
import { useWaveform } from "../../hooks/useWaveform";
import { useUi } from "../../uiStore";
import { CUE_COLORS } from "../../lib/presets";
import { Chips, Group, NumField, Row, Slider } from "../controls";
import { ask } from "../../uiStore";
import { useT, type TKey } from "../../i18n";
import { BasicsTab } from "./inspector/BasicsTab";
import { SoundTab } from "./inspector/SoundTab";
import { TimingTab } from "./inspector/TimingTab";
import { NotesTab } from "./inspector/NotesTab";

export function Inspector() {
  const primary = useDoc((s) => s.primary);
  const selection = useDoc((s) => s.selection);
  const cue = useDoc((s) => findCue(s.show, s.primary));
  const tab = useDoc((s) => s.buildTab);
  const pad = useDoc((s) => s.show.pads.find((p) => p.id === s.selectedPad) ?? null);

  if (tab === "pads") {
    if (!pad) {
      return (
        <Panel>
          <span className="k">Pad</span>
          <p style={{ color: "var(--dim)", fontSize: 14, lineHeight: 1.5, margin: 0 }}>
            Select a pad to edit its sound. Pads are short effects (applause, a gong) you fire in Run with keys 1–9 and 0.
          </p>
        </Panel>
      );
    }
    return <CueInspector key={pad.id} cue={pad.cue} pad={pad} />;
  }

  if (selection.length > 1) return <MultiInspector count={selection.length} />;
  if (!cue || !primary) {
    return (
      <Panel>
        <span className="k">Inspector</span>
        <p style={{ color: "var(--dim)", fontSize: 14, lineHeight: 1.5, margin: 0 }}>
          Select a cue to edit it. Add audio with <b>+ Add</b> (Ctrl+I) or drag files from Explorer onto the window.
        </p>
      </Panel>
    );
  }
  return <CueInspector key={primary} cue={cue} />;
}

/** The inspector's column: fixed width on the right of Build. */
const ASIDE = { width: 380, flex: "none", borderLeft: "1px solid var(--line)", background: "var(--p1)", minHeight: 0 } as const;

export function Panel({ children }: { children: ReactNode }) {
  return (
    <aside aria-label="Inspector" className="scroll" style={{ ...ASIDE, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      {children}
    </aside>
  );
}

/**
 * Several cues selected: edit the settings they share. A field shows its value when all
 * selected cues agree, otherwise "mixed". Every change goes to all of them as one undo step.
 */
function MultiInspector({ count }: { count: number }) {
  const selection = useDoc((s) => s.selection);
  const show = useDoc((s) => s.show);
  const edit = useDoc((s) => s.edit);
  const cues = selection.map((id) => findCue(show, id)).filter((c): c is Cue => !!c);
  const setAll = (patch: Partial<Cue>, key?: string) =>
    edit((s) => selection.reduce((acc, id) => updateAnyCue(acc, id, patch), s), key ? { coalesce: `bulk:${key}` } : undefined);
  /** The shared value, or undefined when the cues differ. */
  const same = <T,>(get: (c: Cue) => T): T | undefined => {
    const first = cues[0] ? JSON.stringify(get(cues[0])) : undefined;
    return cues.every((c) => JSON.stringify(get(c)) === first) && cues[0] ? get(cues[0]) : undefined;
  };
  const mixed = <span className="mono" style={{ fontSize: 12, color: "var(--mute)" }}>mixed</span>;
  const gain = same((c) => c.gainDb);
  const fadeIn = same((c) => c.fadeIn);
  const fadeOut = same((c) => c.fadeOut);
  const hpf = same((c) => c.hpf ?? 0);
  const duck = same((c) => c.duckBg);
  const follow = same((c) => c.follow.kind);
  const color = same((c) => c.color);

  return (
    <Panel>
      <span className="k">Inspector · {count} cues</span>
      <span style={{ fontSize: 20, fontWeight: 700 }}>{cues.map((c) => c.number).join(", ")}</span>
      <p style={{ color: "var(--dim)", fontSize: 13, margin: 0, lineHeight: 1.5 }}>
        Changes here apply to all selected cues (one undo step). Drag them by a row to move them together, or use Alt+↑ / Alt+↓.
      </p>
      <Group title="Colour">
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <button className="b chip" aria-pressed={color === null} onClick={() => setAll({ color: null })}>None</button>
          {CUE_COLORS.map((c) => (
            <button key={c.value} className="b" aria-label={c.name} title={c.name} onClick={() => setAll({ color: c.value })}
              style={{ width: 30, height: 30, borderRadius: 15, background: c.value, boxShadow: color?.toUpperCase() === c.value ? "0 0 0 2px var(--bg), 0 0 0 4px var(--hl)" : "none" }} />
          ))}
          {color === undefined && mixed}
        </div>
      </Group>
      <Group title="Playback">
        <Row label="Gain">
          {gain === undefined && mixed}
          <Slider label="Gain (all)" min={-24} max={12} step={0.5} value={gain ?? 0} format={(v) => (gain === undefined ? "set all" : fmtDb(v))} onChange={(v) => setAll({ gainDb: v }, "gain")} />
        </Row>
        <Row label="Fade in">{fadeIn === undefined && mixed}<NumField label="Fade in (all)" unit="s" value={fadeIn ?? 0} min={0} onChange={(v) => setAll({ fadeIn: v })} /></Row>
        <Row label="Fade out">{fadeOut === undefined && mixed}<NumField label="Fade out (all)" unit="s" value={fadeOut ?? 0} min={0} onChange={(v) => setAll({ fadeOut: v })} /></Row>
      </Group>
      <Group title="Timing and show">
        <Row label="Then">
          <Chips<Follow["kind"] | "">
            label="Follow (all)" value={follow ?? ""}
            onChange={(kind) => kind && setAll({ follow: kind === "afterStart" ? { kind, delay: 10 } : { kind } })}
            options={[{ value: "none", label: "Wait for GO" }, { value: "afterEnd", label: "Next at end" }, { value: "afterStart", label: "Next after 10 s" }]} />
        </Row>
        <Row label="Background">
          <Chips<boolean | "">
            label="Duck background (all)" value={duck ?? ""} onChange={(v) => v !== "" && setAll({ duckBg: v })}
            options={[{ value: true, label: "Ducks" }, { value: false, label: "Leaves it" }]} />
        </Row>
        <Row label="High-pass">
          <Chips<number | "">
            label="High-pass (all)" value={hpf ?? ""} onChange={(v) => v !== "" && setAll({ hpf: v === 0 ? null : v })}
            options={[{ value: 0, label: "Off" }, { value: 60, label: "60 Hz" }, { value: 80, label: "80 Hz" }, { value: 120, label: "120 Hz" }]} />
        </Row>
      </Group>
      <button className="b btn btn-danger" onClick={() => void deleteCues(selection)} style={{ alignSelf: "flex-start" }}>Delete {count} cues</button>
    </Panel>
  );
}

export async function deleteCues(ids: string[]) {
  if (!ids.length) return;
  const show = useDoc.getState().show;
  const names = ids.map((id) => findCue(show, id)).filter((c): c is Cue => !!c);
  const ok = await ask({
    title: names.length === 1 ? "Delete cue?" : `Delete ${names.length} cues?`,
    body: names.length === 1 ? `${names[0].number} ${names[0].name} will be removed. Undo (Ctrl+Z) brings it back.` : `${names.map((c) => c.number).join(", ")} will be removed. Undo (Ctrl+Z) brings them back.`,
    confirmLabel: "Delete",
    danger: true,
  });
  if (!ok) return;
  useDoc.getState().edit((s) => removeCues(s, ids));
  useDoc.getState().setSelection([]);
}

/** The inspector tab shown last; kept while you click from cue to cue. */
let lastTab: InsTab = "basics";
type InsTab = "basics" | "sound" | "timing" | "notes";
const TABS: { id: InsTab; label: TKey }[] = [
  { id: "basics", label: "insp.basics" },
  { id: "sound", label: "insp.sound" },
  { id: "timing", label: "insp.timing" },
  { id: "notes", label: "insp.notes" },
];

function CueInspector({ cue, pad }: { cue: Cue; pad?: Pad }) {
  const t = useT();
  const edit = useDoc((s) => s.edit);
  const show = useDoc((s) => s.show);
  const previewing = usePreview((s) => s.state?.playing && s.cueId === cue.id);
  // Cues this one may hang on: GO cues other than itself (selectors must not build new arrays, so compute here).
  const parents = goQueue(show).filter((c) => c.id !== cue.id);
  const dupNumber = allCues(show).some((c) => c.id !== cue.id && c.number === cue.number);
  const hasChildren = show.sections.some((sec) => sec.cues.some((c) => c.attach?.to === cue.id));
  const waveform = useWaveform(cue.file);
  const [tabState, setTabState] = useState<InsTab>(lastTab);
  const setTab = (x: InsTab) => { lastTab = x; setTabState(x); };
  // Pads have no notes.
  const tabs = pad ? TABS.filter((x) => x.id !== "notes") : TABS;
  const tab = tabs.some((x) => x.id === tabState) ? tabState : "basics";

  useEffect(() => ensureWaveform(cue.id), [cue.id, cue.file]);

  const set = (patch: Partial<Cue>, key?: string) => edit((s) => updateAnyCue(s, cue.id, patch), key ? { coalesce: `${cue.id}:${key}` } : undefined);

  return (
    <aside aria-label="Inspector" style={{ ...ASIDE, display: "flex", flexDirection: "column" }}>
      {/* Header: number (or pad key) and name, then the big editor button. Stays put while the tab scrolls. */}
      <div style={{ padding: "16px 18px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {pad ? (
            <select className="select mono" aria-label="Pad hotkey" value={pad.hotkey} title="Key that fires this pad in Run"
              onChange={(e) => edit((s) => updatePad(s, pad.id, { hotkey: e.target.value }))} style={{ width: 64, height: 38, fontSize: 17, fontWeight: 600, color: "var(--acc)" }}>
              <option value="">–</option>
              {PAD_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          ) : (
            <input className="input mono" aria-label="Cue number" title="Your own number (decimals like 2.5 are fine). View › Renumber all cues resets them."
              value={cue.number} onChange={(e) => set({ number: e.target.value.trim() || cue.number }, "number")}
              style={{ width: 60, height: 38, fontSize: 18, fontWeight: 600, color: "var(--acc)", textAlign: "center" }} />
          )}
          <input className="input" aria-label="Name" value={cue.name} onChange={(e) => set({ name: e.target.value }, "name")} style={{ flex: 1, minWidth: 0, fontSize: 17, fontWeight: 700, height: 38 }} />
        </div>
        {!pad && dupNumber && <span className="tag tag-amb" title="Another cue has the same number" style={{ alignSelf: "flex-start" }}>SAME NUMBER</span>}
        {pad && (
          <Chips label="Pad mode" value={pad.mode} onChange={(mode) => edit((s) => updatePad(s, pad.id, { mode }))}
            options={PAD_MODES.map((m) => ({ value: m.value, label: m.label, title: m.hint }))} />
        )}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 6 }}>
          <button className="b btn cond" onClick={() => useUi.getState().openEditor(cue.id)} title="Waveform, EQ and compressor in a big editor (or double-click the cue)"
            style={{ height: 44, justifyContent: "center", background: "var(--hl)", color: "var(--bg)", fontSize: 14, fontWeight: 800, letterSpacing: ".06em" }}>
            {t("insp.openEditor")} · Enter
          </button>
          <button className="b btn" onClick={() => previewToggle(cue)} aria-pressed={!!previewing} title="Listen in the headphones (H)"
            style={{ height: 44, background: previewing ? "var(--st)" : "var(--stbg)", color: previewing ? "var(--bg)" : "var(--st)", fontWeight: 700 }}>
            {previewing ? t("insp.stopPreview") : `${t("insp.preview")} · H`}
          </button>
        </div>
      </div>

      <div role="tablist" aria-label="Inspector" style={{ display: "flex", gap: 2, padding: "0 18px", borderBottom: "1px solid var(--line)" }}>
        {tabs.map((x) => (
          <button key={x.id} role="tab" aria-selected={tab === x.id} className="b" onClick={() => setTab(x.id)}
            style={{ height: 40, padding: "0 12px", background: "transparent", fontSize: 14, fontWeight: 700, color: tab === x.id ? "var(--text)" : "var(--mute)", boxShadow: tab === x.id ? "inset 0 -3px 0 var(--acc)" : "none" }}>
            {t(x.label)}
          </button>
        ))}
      </div>

      <div className="scroll" style={{ flex: 1, minHeight: 0, padding: "14px 18px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
        {tab === "basics" && <BasicsTab cue={cue} pad={pad} set={set} waveform={waveform} />}
        {tab === "sound" && <SoundTab cue={cue} pad={pad} set={set} settings={show.settings} />}
        {tab === "timing" && <TimingTab cue={cue} pad={pad} set={set} parents={parents} hasChildren={hasChildren} />}
        {tab === "notes" && <NotesTab cue={cue} set={set} />}

        <div style={{ marginTop: "auto", paddingTop: 12, borderTop: "1px solid var(--line)", display: "flex", justifyContent: "flex-end" }}>
          {pad ? (
            <button className="b btn btn-danger" onClick={() => void deletePad(pad)}>Delete pad</button>
          ) : (
            <button className="b btn btn-danger" onClick={() => void deleteCues([cue.id])}>Delete cue</button>
          )}
        </div>
      </div>
    </aside>
  );
}

export async function deletePad(pad: Pad) {
  const ok = await ask({ title: "Delete pad?", body: `Pad ${pad.hotkey || ""} “${pad.cue.name}” will be removed. Undo (Ctrl+Z) brings it back.`, confirmLabel: "Delete", danger: true });
  if (!ok) return;
  useDoc.getState().edit((s) => removePad(s, pad.id));
  useDoc.getState().selectPad(null);
}
