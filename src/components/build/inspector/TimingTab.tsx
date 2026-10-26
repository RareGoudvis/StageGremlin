// Inspector › Timing: when the cue starts and stops, and how it plays with the rest of the show.

import type { Cue, Pad } from "../../../types";
import { fmtTime } from "../../../lib/format";
import { trimmedLen } from "../../../types";
import { Chips, Group, NumField, Row } from "../../controls";
import type { SetCue } from "./types";

export function TimingTab({ cue, pad, set, parents, hasChildren }: { cue: Cue; pad?: Pad; set: SetCue; parents: Cue[]; hasChildren: boolean }) {
  const len = trimmedLen(cue);
  return (
    <>
      <Group title="Start and stop" right={<span className="mono" style={{ fontSize: 12, color: "var(--dim)" }}>{len != null ? `plays ${fmtTime(len)}` : ""}</span>}>
        {!pad && <Row label="Pre-wait" hint="Wait this long after GO before it starts"><NumField label="Pre-wait" unit="s" value={cue.preWait} min={0} onChange={(v) => set({ preWait: v })} /></Row>}
        <Row label="Trim in">
          <NumField label="Trim in" unit="s" value={cue.trimIn} min={0} onChange={(v) => set({ trimIn: v })} />
        </Row>
        <Row label="Trim out" hint="Empty = play to the end of the file">
          <NumField label="Trim out" unit="s" value={cue.trimOut ?? cue.loudness?.duration ?? 0} min={0} onChange={(v) => set({ trimOut: cue.loudness && v >= cue.loudness.duration ? null : v })} />
          <button className="b chip" aria-pressed={cue.trimOut === null} onClick={() => set({ trimOut: null })}>To end</button>
        </Row>
        {!pad && (
          <Row label="Plays">
            <Chips label="Play count" value={cue.playCount} onChange={(playCount) => set({ playCount })}
              options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: `${n}×` })).concat([{ value: 0, label: "Loop" }])} />
          </Row>
        )}
        <Row label="Stop fade" hint="Fade used when this cue is stopped (S)"><NumField label="Stop fade" unit="s" value={cue.stopFade} min={0} onChange={(v) => set({ stopFade: v })} /></Row>
        <Row label="Curve">
          <Chips<Cue["curve"]> label="Fade curve" value={cue.curve} onChange={(curve) => set({ curve })} options={[{ value: "linear", label: "Linear" }, { value: "sCurve", label: "S-curve" }, { value: "exponential", label: "Exponential" }]} />
        </Row>
      </Group>

      <Group title="With the rest of the show">
        {!pad && (
          <Row label="Attach to" hint="Starts by itself at a moment inside another cue; skips the GO queue">
            <select
              className="select" aria-label="Attach to cue" value={cue.attach?.to ?? ""} disabled={hasChildren}
              title={hasChildren ? "Other cues are attached to this one" : undefined}
              onChange={(e) => set({ attach: e.target.value ? { to: e.target.value, at: cue.attach?.at ?? 0 } : null })}
              style={{ flex: 1, minWidth: 0 }}
            >
              <option value="">— not attached (GO cue) —</option>
              {parents.map((p) => <option key={p.id} value={p.id}>{p.number} {p.name}</option>)}
            </select>
            {cue.attach && <NumField label="Attach time" unit="s in" value={cue.attach.at} min={0} onChange={(at) => set({ attach: { to: cue.attach!.to, at } })} />}
          </Row>
        )}
        {!pad && (
          <Row label="Fade & GO" hint="GO on this cue fades out everything else">
            <Chips label="Fade and GO" value={cue.fadeGo ?? 0} onChange={(v) => set({ fadeGo: v === 0 ? null : v })}
              options={[{ value: 0, label: "Off" }, { value: 2, label: "Others 2 s" }, { value: 4, label: "Others 4 s" }]} />
          </Row>
        )}
        <Row label="Background">
          <button className="b chip" aria-pressed={cue.duckBg} onClick={() => set({ duckBg: !cue.duckBg })}>{cue.duckBg ? "Ducks background" : "Leaves background"}</button>
        </Row>
      </Group>
    </>
  );
}
