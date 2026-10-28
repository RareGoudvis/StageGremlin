// Inspector › Notes: what the sound, light and stage people need to know about this cue.
// They show on the printed cue sheet and in Run.

import type { Cue } from "../../../types";
import { TextField } from "../../controls";
import type { SetCue } from "./types";
import { useT } from "../../../i18n";

export function NotesTab({ cue, set }: { cue: Cue; set: SetCue }) {
  const t = useT();
  return (
    <>
      <span className="k" style={{ color: "var(--amb)" }}>{t("insp.sound")}</span>
      <TextField multiline label={t("b.notes.sound")} value={cue.notes.sound} onChange={(v) => set({ notes: { ...cue.notes, sound: v } }, "notes.sound")} />
      <span className="k" style={{ color: "var(--lx)" }}>{t("b.notes.light")}</span>
      <TextField multiline label={t("b.notes.lightNotes")} value={cue.notes.lx} onChange={(v) => set({ notes: { ...cue.notes, lx: v } }, "notes.lx")} />
      <span className="k" style={{ color: "var(--st)" }}>{t("b.notes.stage")}</span>
      <TextField multiline label={t("b.notes.stageNotes")} value={cue.notes.stage} onChange={(v) => set({ notes: { ...cue.notes, stage: v } }, "notes.stage")} />
    </>
  );
}
