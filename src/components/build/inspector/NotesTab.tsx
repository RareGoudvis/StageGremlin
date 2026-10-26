// Inspector › Notes: what the sound, light and stage people need to know about this cue.
// They show on the printed cue sheet and in Run.

import type { Cue } from "../../../types";
import { TextField } from "../../controls";
import type { SetCue } from "./types";

export function NotesTab({ cue, set }: { cue: Cue; set: SetCue }) {
  return (
    <>
      <span className="k" style={{ color: "var(--amb)" }}>Sound</span>
      <TextField multiline label="Sound notes" value={cue.notes.sound} onChange={(v) => set({ notes: { ...cue.notes, sound: v } }, "notes.sound")} />
      <span className="k" style={{ color: "var(--lx)" }}>Light (LX)</span>
      <TextField multiline label="Light notes" value={cue.notes.lx} onChange={(v) => set({ notes: { ...cue.notes, lx: v } }, "notes.lx")} />
      <span className="k" style={{ color: "var(--st)" }}>Stage</span>
      <TextField multiline label="Stage notes" value={cue.notes.stage} onChange={(v) => set({ notes: { ...cue.notes, stage: v } }, "notes.stage")} />
    </>
  );
}
