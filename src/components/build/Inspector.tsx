// Right-hand panel in Build: every setting of the selected cue — or of the selected
// pad's cue (pads use the same sound chain, so the same panel edits them).
// Each control calls `set(patch, key)`; the key merges rapid changes (typing, sliders) into one undo step.

import { useEffect, useState, type ReactNode } from "react";
import { useDoc } from "../../store";
import type { Cue, Follow, Pad } from "../../types";
import { goQueue, trimmedLen } from "../../types";
import { findCue, PAD_KEYS, PAD_MODES, removeCues, removePad, updateAnyCue, updatePad } from "../../lib/showOps";
import { ensureWaveform } from "../../lib/fileActions";
import { fmtDb, fmtSecs, fmtTime } from "../../lib/format";
import { previewToggle, usePreview } from "../../lib/preview";
import { useWaveform } from "../../hooks/useWaveform";
import { useUi } from "../../uiStore";
import { FileStatus } from "./FileStatus";
import { COMP_PRESETS, CUE_COLORS, EQ_PRESETS, matchCompPreset, matchEqPreset } from "../../lib/presets";
import { Chips, Group, NumField, Row, Slider, TextField } from "../controls";
import { Waveform } from "./Waveform";
import { ask } from "../../uiStore";

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
          Select a cue to edit it. Import audio with <b>Import</b> (Ctrl+I) or drop files on the window.
        </p>
      </Panel>
    );
  }
  return <CueInspector key={primary} cue={cue} />;
}

export function Panel({ children }: { children: ReactNode }) {
  return (
    <aside aria-label="Inspector" className="scroll" style={{ borderLeft: "1px solid var(--line)", background: "var(--p1)", padding: 16, display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
      {children}
    </aside>
  );
}

function MultiInspector({ count }: { count: number }) {
  const deleteSelected = () => deleteCues(useDoc.getState().selection);
  return (
    <Panel>
      <span className="k">Inspector</span>
      <span style={{ fontSize: 20, fontWeight: 700 }}>{count} cues selected</span>
      <p style={{ color: "var(--dim)", fontSize: 13.5, margin: 0, lineHeight: 1.5 }}>
        Drag them by a row to move them together, or use Alt+↑ / Alt+↓. Delete removes all of them.
      </p>
      <button className="b btn btn-danger" onClick={deleteSelected} style={{ alignSelf: "flex-start" }}>Delete {count} cues</button>
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

function CueInspector({ cue, pad }: { cue: Cue; pad?: Pad }) {
  const edit = useDoc((s) => s.edit);
  const show = useDoc((s) => s.show);
  const previewing = usePreview((s) => s.state?.playing && s.cueId === cue.id);
  // Cues this one may hang on: GO cues other than itself (selectors must not build new arrays, so compute here).
  const parents = goQueue(show).filter((c) => c.id !== cue.id);
  const hasChildren = show.sections.some((sec) => sec.cues.some((c) => c.attach?.to === cue.id));
  const waveform = useWaveform(cue.file);

  useEffect(() => ensureWaveform(cue.id), [cue.id, cue.file]);

  const set = (patch: Partial<Cue>, key?: string) => edit((s) => updateAnyCue(s, cue.id, patch), key ? { coalesce: `${cue.id}:${key}` } : undefined);
  const settings = show.settings;
  const len = trimmedLen(cue);
  const eqPreset = matchEqPreset(cue.eq.map((b) => b.gainDb));
  const compPreset = matchCompPreset(cue.comp);

  return (
    <Panel>
      {/* Header: number (automatic) or pad key, and name */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {pad ? (
          <select className="select mono" aria-label="Pad hotkey" value={pad.hotkey} title="Key that fires this pad in Run"
            onChange={(e) => edit((s) => updatePad(s, pad.id, { hotkey: e.target.value }))} style={{ width: 64, height: 38, fontSize: 17, fontWeight: 600, color: "var(--acc)" }}>
            <option value="">–</option>
            {PAD_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        ) : (
          <span className="mono" title="Numbers update automatically" style={{ fontSize: 22, fontWeight: 600, color: "var(--acc)", minWidth: 36 }}>{cue.number}</span>
        )}
        <input className="input" aria-label="Name" value={cue.name} onChange={(e) => set({ name: e.target.value }, "name")} style={{ flex: 1, fontSize: 17, fontWeight: 700, height: 38 }} />
      </div>
      {pad && (
        <Row label="When pressed">
          <Chips label="Pad mode" value={pad.mode} onChange={(mode) => edit((s) => updatePad(s, pad.id, { mode }))}
            options={PAD_MODES.map((m) => ({ value: m.value, label: m.label, title: m.hint }))} />
        </Row>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 6 }}>
        <button className="b btn cond" onClick={() => useUi.getState().openEditor(cue.id)} title={pad ? "Waveform, EQ and compressor in a big editor" : "Double-click the cue or press Enter"}
          style={{ height: 40, justifyContent: "center", background: "var(--hl)", color: "var(--bg)", fontSize: 14, fontWeight: 800, letterSpacing: ".06em" }}>
          OPEN EDITOR
        </button>
        <button className="b btn" onClick={() => previewToggle(cue)} aria-pressed={!!previewing} title="Listen in the headphones (H)"
          style={{ height: 40, background: previewing ? "var(--st)" : "var(--stbg)", color: previewing ? "var(--bg)" : "var(--st)", fontWeight: 700 }}>
          {previewing ? "Stop preview" : "Preview · H"}
        </button>
      </div>

      <FileStatus cue={cue} />

      <Waveform cue={cue} waveform={waveform} onChange={(p, key) => set(p, key)} />

      <Group title="Colour">
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <button className="b chip" aria-pressed={cue.color === null} onClick={() => set({ color: null })}>None</button>
          {CUE_COLORS.map((c) => (
            <button
              key={c.value}
              className="b"
              aria-label={c.name}
              aria-pressed={cue.color?.toUpperCase() === c.value}
              title={c.name}
              onClick={() => set({ color: c.value })}
              style={{ width: 30, height: 30, borderRadius: 15, background: c.value, boxShadow: cue.color?.toUpperCase() === c.value ? "0 0 0 2px var(--bg), 0 0 0 4px var(--hl)" : "none" }}
            />
          ))}
          <CustomColor value={cue.color} onChange={(v) => set({ color: v }, "color")} />
        </div>
      </Group>

      {!pad && <Group title="Notes">
        <span className="k" style={{ color: "var(--amb)" }}>Sound</span>
        <TextField multiline label="Sound notes" value={cue.notes.sound} onChange={(v) => set({ notes: { ...cue.notes, sound: v } }, "notes.sound")} />
        <span className="k" style={{ color: "var(--lx)" }}>Light (LX)</span>
        <TextField multiline label="Light notes" value={cue.notes.lx} onChange={(v) => set({ notes: { ...cue.notes, lx: v } }, "notes.lx")} />
        <span className="k" style={{ color: "var(--st)" }}>Stage</span>
        <TextField multiline label="Stage notes" value={cue.notes.stage} onChange={(v) => set({ notes: { ...cue.notes, stage: v } }, "notes.stage")} />
      </Group>}

      <Group title="Playback" right={<span className="mono" style={{ fontSize: 12, color: "var(--dim)" }}>{len != null ? `plays ${fmtTime(len)}` : ""}</span>}>
        <Row label="Trim in">
          <NumField label="Trim in" unit="s" value={cue.trimIn} min={0} onChange={(v) => set({ trimIn: v })} />
        </Row>
        <Row label="Trim out" hint="Empty = play to the end of the file">
          <NumField label="Trim out" unit="s" value={cue.trimOut ?? cue.loudness?.duration ?? 0} min={0} onChange={(v) => set({ trimOut: cue.loudness && v >= cue.loudness.duration ? null : v })} />
          <button className="b chip" aria-pressed={cue.trimOut === null} onClick={() => set({ trimOut: null })}>To end</button>
        </Row>
        <Row label="Gain">
          <Slider label="Gain" min={-24} max={12} step={0.5} value={cue.gainDb} format={(v) => fmtDb(v)} onChange={(v) => set({ gainDb: v }, "gain")} />
        </Row>
        <Row label="Pan">
          <Slider label="Pan" min={-1} max={1} step={0.05} value={cue.pan} format={(v) => (Math.abs(v) < 0.01 ? "C" : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)} onChange={(v) => set({ pan: v }, "pan")} />
        </Row>
        <Row label="Fade in"><NumField label="Fade in" unit="s" value={cue.fadeIn} min={0} onChange={(v) => set({ fadeIn: v })} /></Row>
        <Row label="Fade out"><NumField label="Fade out" unit="s" value={cue.fadeOut} min={0} onChange={(v) => set({ fadeOut: v })} /></Row>
        <Row label="Stop fade" hint="Fade used when this cue is stopped (S)"><NumField label="Stop fade" unit="s" value={cue.stopFade} min={0} onChange={(v) => set({ stopFade: v })} /></Row>
        <Row label="Curve">
          <Chips<Cue["curve"]> label="Fade curve" value={cue.curve} onChange={(curve) => set({ curve })} options={[{ value: "linear", label: "Linear" }, { value: "sCurve", label: "S-curve" }, { value: "exponential", label: "Exponential" }]} />
        </Row>
      </Group>

      {!pad && <Group title="Timing">
        <Row label="Pre-wait" hint="Wait this long after GO before it starts"><NumField label="Pre-wait" unit="s" value={cue.preWait} min={0} onChange={(v) => set({ preWait: v })} /></Row>
        <Row label="Plays">
          <Chips label="Play count" value={cue.playCount} onChange={(playCount) => set({ playCount })}
            options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: `${n}×` })).concat([{ value: 0, label: "Loop" }])} />
        </Row>
        <Row label="Then">
          <Chips<Follow["kind"]> label="Follow" value={cue.follow.kind}
            onChange={(kind) => set({ follow: kind === "afterStart" ? { kind, delay: cue.follow.kind === "afterStart" ? cue.follow.delay : 10 } : { kind } })}
            options={[{ value: "none", label: "Wait for GO" }, { value: "afterEnd", label: "Next at end" }, { value: "afterStart", label: "Next after…" }]} />
          {cue.follow.kind === "afterStart" && (
            <NumField label="Follow delay" unit="s after start" value={cue.follow.delay} min={0} onChange={(delay) => set({ follow: { kind: "afterStart", delay } })} />
          )}
        </Row>
        <Row label="Attach to" hint="Starts by itself at a moment inside another cue; skips the GO queue">
          <select
            className="select" aria-label="Attach to cue" value={cue.attach?.to ?? ""} disabled={hasChildren}
            title={hasChildren ? "Other cues are attached to this one" : undefined}
            onChange={(e) => set({ attach: e.target.value ? { to: e.target.value, at: cue.attach?.at ?? 0 } : null })}
            style={{ flex: 1 }}
          >
            <option value="">— not attached (GO cue) —</option>
            {parents.map((p) => <option key={p.id} value={p.id}>{p.number} {p.name}</option>)}
          </select>
          {cue.attach && <NumField label="Attach time" unit="s in" value={cue.attach.at} min={0} onChange={(at) => set({ attach: { to: cue.attach!.to, at } })} />}
        </Row>
      </Group>}

      <Group title="During the show">
        <Row label="Background">
          <button className="b chip" aria-pressed={cue.duckBg} onClick={() => set({ duckBg: !cue.duckBg })}>{cue.duckBg ? "Ducks background" : "Leaves background"}</button>
        </Row>
        {!pad && <Row label="Fade & GO" hint="GO on this cue fades out everything else">
          <Chips label="Fade and GO" value={cue.fadeGo ?? 0} onChange={(v) => set({ fadeGo: v === 0 ? null : v })}
            options={[{ value: 0, label: "Off" }, { value: 2, label: "Fade others 2 s" }, { value: 4, label: "Fade others 4 s" }]} />
        </Row>}
        {!pad && <Row label="Under (U)" hint="Level U drops this cue to while someone talks">
          <button className="b chip" aria-pressed={cue.underDb === null} onClick={() => set({ underDb: null })}>Show default {settings.underDb} dB</button>
          <button className="b chip" aria-pressed={cue.underDb !== null} onClick={() => set({ underDb: cue.underDb ?? settings.underDb })}>Own</button>
          {cue.underDb !== null && <NumField label="Under level" unit="dB" value={cue.underDb} max={0} min={-40} step={1} digits={0} onChange={(v) => set({ underDb: v })} />}
        </Row>}
      </Group>

      <Group title="Tone">
        <Row label="High-pass">
          <Chips label="High-pass" value={cue.hpf ?? 0} onChange={(v) => set({ hpf: v === 0 ? null : v })}
            options={[{ value: 0, label: "Off" }, { value: 60, label: "60 Hz" }, { value: 80, label: "80 Hz" }, { value: 120, label: "120 Hz" }]} />
        </Row>
        <Row label="EQ preset">
          <select
            className="select" aria-label="EQ preset" value={eqPreset?.name ?? ""} style={{ flex: 1 }}
            onChange={(e) => {
              const p = EQ_PRESETS.find((x) => x.name === e.target.value);
              if (!p) return;
              set({ eq: cue.eq.map((b, i) => ({ ...b, gainDb: p.gains[i] })) as Cue["eq"], ...(p.hpf !== undefined ? { hpf: p.hpf } : {}) });
            }}
          >
            {!eqPreset && <option value="">Custom</option>}
            {EQ_PRESETS.map((p) => <option key={p.name} value={p.name} title={p.tip}>{p.name}</option>)}
          </select>
        </Row>
        {eqPreset && eqPreset.name !== "Flat" && <span style={{ fontSize: 12, color: "var(--mute)" }}>{eqPreset.tip}</span>}
        {cue.eq.map((band, i) => (
          <Row key={i} label={band.freq >= 1000 ? `${band.freq / 1000} kHz` : `${band.freq} Hz`}>
            <Slider label={`EQ ${band.freq} Hz`} min={-12} max={12} step={0.5} value={band.gainDb} format={(v) => fmtDb(v)}
              onChange={(v) => set({ eq: cue.eq.map((b, j) => (j === i ? { ...b, gainDb: v } : b)) as Cue["eq"] }, `eq${i}`)} />
          </Row>
        ))}
        <Row label="Compressor">
          <button className="b chip" aria-pressed={cue.comp.on} onClick={() => set({ comp: { ...cue.comp, on: !cue.comp.on } })}>{cue.comp.on ? "On" : "Off"}</button>
          <Chips label="Compressor preset" value={cue.comp.on ? compPreset : null}
            onChange={(name) => {
              const p = COMP_PRESETS.find((x) => x.name === name);
              if (p) set({ comp: { on: true, ...p.comp } });
            }}
            options={COMP_PRESETS.map((p) => ({ value: p.name as string | null, label: p.name, title: `${p.comp.thresholdDb} dB, ${p.comp.ratio}:1` }))} />
        </Row>
      </Group>

      <div style={{ paddingTop: 12, borderTop: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="mono" style={{ fontSize: 11.5, color: "var(--mute)" }}>{cue.stopFade > 0 ? `stop fade ${fmtSecs(cue.stopFade)}` : ""}</span>
        {pad ? (
          <button className="b btn btn-danger" onClick={() => void deletePad(pad)}>Delete pad</button>
        ) : (
          <button className="b btn btn-danger" onClick={() => void deleteCues([cue.id])}>Delete cue</button>
        )}
      </div>
    </Panel>
  );
}

async function deletePad(pad: Pad) {
  const ok = await ask({ title: "Delete pad?", body: `Pad ${pad.hotkey || ""} “${pad.cue.name}” will be removed. Undo (Ctrl+Z) brings it back.`, confirmLabel: "Delete", danger: true });
  if (!ok) return;
  useDoc.getState().edit((s) => removePad(s, pad.id));
  useDoc.getState().selectPad(null);
}

/** Custom colour: a native picker plus a hex box for typing an exact RGB value. */
function CustomColor({ value, onChange }: { value: string | null; onChange: (v: string) => void }) {
  const [text, setText] = useState(value ?? "");
  useEffect(() => setText(value ?? ""), [value]);
  const commit = () => {
    const v = text.trim().replace(/^([^#])/, "#$1");
    if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v.toUpperCase());
    else setText(value ?? "");
  };
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
      <input type="color" aria-label="Custom colour" value={value ?? "#888888"} onChange={(e) => onChange(e.target.value.toUpperCase())} style={{ width: 34, height: 30, border: 0, padding: 0, background: "transparent" }} />
      <input className="input mono" aria-label="Colour hex code" value={text} placeholder="#RRGGBB" onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} style={{ width: 86, height: 30 }} />
    </span>
  );
}
