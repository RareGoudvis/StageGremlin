// Inspector › Basics: the file, the waveform, colour, fades, gain and what happens after this cue.
// What you touch for almost every cue; the rarer settings live in the other tabs.

import { useEffect, useState } from "react";
import type { Cue, Follow, Pad } from "../../../types";
import { fmtDb } from "../../../lib/format";
import { CUE_COLORS } from "../../../lib/presets";
import { Chips, Group, NumField, Row, Slider } from "../../controls";
import { FileStatus } from "../FileStatus";
import { Waveform } from "../Waveform";
import type { SetCue } from "./types";

export function BasicsTab({ cue, pad, set, waveform }: { cue: Cue; pad?: Pad; set: SetCue; waveform: number[] | undefined }) {
  return (
    <>
      <FileStatus cue={cue} />
      <Waveform cue={cue} waveform={waveform} onChange={(p, key) => set(p, key)} />

      <Group title="Colour">
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <button className="b chip" aria-pressed={cue.color === null} onClick={() => set({ color: null })}>None</button>
          {CUE_COLORS.map((c) => (
            <button
              key={c.value} className="b" aria-label={c.name} aria-pressed={cue.color?.toUpperCase() === c.value} title={c.name}
              onClick={() => set({ color: c.value })}
              style={{ width: 28, height: 28, borderRadius: 14, background: c.value, boxShadow: cue.color?.toUpperCase() === c.value ? "0 0 0 2px var(--bg), 0 0 0 4px var(--hl)" : "none" }}
            />
          ))}
          <CustomColor value={cue.color} onChange={(v) => set({ color: v }, "color")} />
        </div>
      </Group>

      <Group title="Level and fades">
        <Row label="Gain">
          <Slider label="Gain" min={-24} max={12} step={0.5} value={cue.gainDb} format={(v) => fmtDb(v)} onChange={(v) => set({ gainDb: v }, "gain")} />
        </Row>
        <Row label="Fade in"><NumField label="Fade in" unit="s" value={cue.fadeIn} min={0} onChange={(v) => set({ fadeIn: v })} /></Row>
        <Row label="Fade out"><NumField label="Fade out" unit="s" value={cue.fadeOut} min={0} onChange={(v) => set({ fadeOut: v })} /></Row>
      </Group>

      {!pad && (
        <Group title="After this cue">
          <Chips<Follow["kind"]> label="Follow" value={cue.follow.kind}
            onChange={(kind) => set({ follow: kind === "afterStart" ? { kind, delay: cue.follow.kind === "afterStart" ? cue.follow.delay : 10 } : { kind } })}
            options={[{ value: "none", label: "Wait for GO" }, { value: "afterEnd", label: "Next at end" }, { value: "afterStart", label: "Next after…" }]} />
          {cue.follow.kind === "afterStart" && (
            <NumField label="Follow delay" unit="s after start" value={cue.follow.delay} min={0} onChange={(delay) => set({ follow: { kind: "afterStart", delay } })} />
          )}
        </Group>
      )}
    </>
  );
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
