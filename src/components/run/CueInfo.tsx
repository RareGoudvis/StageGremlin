// Pieces shared by Run's dock, Big mode and Dumbo mode:
// - CueNotes: a cue's sound / light / stage notes, each in its own colour.
// - LaterList: every GO cue still to come after the standby cue ("After that"), with its length.
// - NotesDock: the dock's Notes tab — notes of what plays now, what stands by, and the one after.

import { useDoc } from "../../store";
import { useEngine } from "../../engineStore";
import type { Cue } from "../../types";
import { goQueue, trimmedLen } from "../../types";
import { findCue } from "../../lib/showOps";
import { mainRunning } from "../../lib/showMath";
import { fmtTime } from "../../lib/format";
import { useT } from "../../i18n";

/** Sound, light and stage notes of one cue. `scale` makes everything bigger for Big / Dumbo mode. */
export function CueNotes({ cue, scale = 1, showEmpty }: { cue: Cue; scale?: number; showEmpty?: boolean }) {
  const t = useT();
  const lines = [
    { text: cue.notes.sound, label: t("r.notes.sound"), color: "var(--ambtx)" },
    { text: cue.notes.lx, label: t("r.notes.lx"), color: "var(--lx)" },
    { text: cue.notes.stage, label: t("r.notes.stage"), color: "var(--st)" },
  ].filter((l) => l.text.trim());
  if (!lines.length) return showEmpty ? <span style={{ fontSize: 13 * scale, color: "var(--mute)" }}>{t("r.notes.none")}</span> : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 * scale }}>
      {lines.map((l) => (
        <span key={l.label} style={{ fontSize: 14 * scale, lineHeight: 1.3, color: l.color }}>
          <span className="k" style={{ fontSize: 10 * scale, color: l.color, marginRight: 8 }}>{l.label}</span>
          {l.text}
        </span>
      ))}
    </div>
  );
}

/** Every GO cue after the standby cue: number, name, length, sound note. Read only. */
export function LaterList({ standbyId, scale = 1 }: { standbyId: string | null; scale?: number }) {
  const t = useT();
  const show = useDoc((s) => s.show);
  const queue = goQueue(show);
  const i = standbyId ? queue.findIndex((c) => c.id === standbyId) : -1;
  const later = i < 0 ? [] : queue.slice(i + 1);
  return (
    <section style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", borderRadius: 16, background: "var(--p1)", border: "1px solid var(--line)" }}>
      <span className="k" style={{ padding: `${10 * scale}px ${16 * scale}px ${6 * scale}px`, fontSize: 11 * scale }}>{t("r.later.title", { n: later.length })}</span>
      <div className="scroll" style={{ flex: 1, minHeight: 0, padding: `0 ${8 * scale}px ${8 * scale}px` }}>
        {later.map((c) => {
          const len = trimmedLen(c);
          return (
            <div key={c.id} style={{ display: "flex", alignItems: "baseline", gap: 10 * scale, padding: `${5 * scale}px ${8 * scale}px`, borderTop: "1px solid var(--line)" }}>
              <span className="mono" style={{ width: 40 * scale, flex: "none", fontSize: 14 * scale, color: "var(--dim)" }}>{c.number}</span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span className="clamp1" style={{ fontSize: 16 * scale, fontWeight: 700 }}>{c.name}</span>
                {c.notes.sound && <span className="clamp1" style={{ fontSize: 13 * scale, color: "var(--ambtx)" }}>{c.notes.sound}</span>}
              </span>
              <span className="mono" style={{ flex: "none", fontSize: 14 * scale, color: "var(--dim)" }}>{len != null ? fmtTime(len) : "–:––"}</span>
            </div>
          );
        })}
        {!later.length && <span style={{ display: "block", padding: 8 * scale, fontSize: 13 * scale, color: "var(--mute)" }}>{t("r.later.none")}</span>}
      </div>
    </section>
  );
}

/** Dock › Notes: what plays now, what stands by, and the cue after that, each with all its notes. */
export function NotesDock() {
  const t = useT();
  const show = useDoc((s) => s.show);
  const playhead = useEngine((s) => s.state?.playhead ?? null);
  const run = mainRunning(useEngine((s) => s.state?.running));
  const queue = goQueue(show);
  const i = playhead ? queue.findIndex((c) => c.id === playhead) : -1;
  const blocks = [
    { label: t("r.notes.now"), cue: run ? findCue(show, run.cueId) : null, color: "var(--acc)" },
    { label: t("r.notes.standby"), cue: i >= 0 ? queue[i] : null, color: "var(--acc)" },
    { label: t("r.notes.then"), cue: i >= 0 ? queue[i + 1] ?? null : null, color: "var(--dim)" },
  ].filter((b): b is { label: string; cue: Cue; color: string } => !!b.cue);
  return (
    <div className="scroll" style={{ flex: 1, minHeight: 0, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 12 }}>
      {blocks.map((b) => (
        <div key={b.label} style={{ display: "flex", flexDirection: "column", gap: 4, paddingBottom: 10, borderBottom: "1px solid var(--line)" }}>
          <span className="k" style={{ fontSize: 10, color: b.color }}>{b.label}</span>
          <span className="clamp1" style={{ fontSize: 15, fontWeight: 700 }}><span className="mono" style={{ color: "var(--dim)", marginRight: 8 }}>{b.cue.number}</span>{b.cue.name}</span>
          <CueNotes cue={b.cue} showEmpty />
        </div>
      ))}
      {!blocks.length && <span style={{ fontSize: 13, color: "var(--mute)" }}>{t("r.notes.empty")}</span>}
    </div>
  );
}
