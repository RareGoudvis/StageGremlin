// Pieces shared by Run's dock, Big mode and Dumbo mode:
// - CueNotes: a cue's sound / light / stage notes, each in its own colour.
// - LaterList: every GO cue still to come after the standby cue ("After that"), with its length.
// - NotesDock: the dock's Notes tab — notes of what plays now, what stands by, and the one after.
// - PendingLine: cues that start by themselves soon (pre-wait, follow), with a countdown.
// - PausedOverlay: the amber PAUSED block over a now-playing card (P = pause all).

import { useDoc } from "../../store";
import { pauseAll } from "../../lib/runActions";
import { useEngine } from "../../engineStore";
import type { Cue } from "../../types";
import { goQueue, trimmedLen } from "../../types";
import { findCue } from "../../lib/showOps";
import { mainRunning } from "../../lib/showMath";
import { fmtTime } from "../../lib/format";
import { useT } from "../../i18n";

/** Cues that start by themselves soon: "5 pre-wait in 0:04". Nothing when none are waiting. */
export function PendingLine({ scale = 1 }: { scale?: number }) {
  const t = useT();
  const show = useDoc((s) => s.show);
  const pending = useEngine((s) => s.state?.pending) ?? [];
  if (!pending.length) return null;
  return (
    <div style={{ display: "flex", gap: 6 * scale, flexWrap: "wrap", alignItems: "center" }}>
      <span className="k" style={{ fontSize: 11 * scale }}>{t("r.np.firesItself")}</span>
      {pending.map((p, i) => {
        const c = findCue(show, p.cueId);
        return (
          <span key={i} className="mono" style={{ fontSize: 13 * scale, padding: `${4 * scale}px ${8 * scale}px`, borderRadius: 6 * scale, background: "var(--p3)", color: "var(--acc)" }}>
            {t(p.kind === "preWait" ? "r.np.preWaitIn" : "r.np.pendingIn", { n: c?.number ?? "", t: fmtTime(p.inSecs) })}
          </span>
        );
      })}
    </div>
  );
}

/** The first cue waiting out its pre-wait (GO was pressed, it hasn't started yet), with seconds left. */
export function usePreWaiting(): { cue: Cue; inSecs: number } | null {
  const show = useDoc((s) => s.show);
  const p = useEngine((s) => s.state?.pending?.find((x) => x.kind === "preWait"));
  const cue = p ? findCue(show, p.cueId) : null;
  return p && cue ? { cue, inSecs: p.inSecs } : null;
}

/**
 * Everything is paused (P): an amber block across the whole card, impossible to miss in a dark booth.
 * Clicking it resumes. The card needs position: relative. `text` differs per screen (Dumbo has no P key).
 */
export function PausedOverlay({ text, radius = 16, size = 40 }: { text: string; radius?: number; size?: number }) {
  const paused = useEngine((s) => !!s.state?.paused);
  if (!paused) return null;
  return (
    <div role="alert" onClick={() => pauseAll()} style={{ position: "absolute", inset: 0, zIndex: 5, borderRadius: radius, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 16 }}>
      <span className="cond" style={{ padding: "14px 28px", borderRadius: 12, background: "var(--amb)", color: "var(--onamb)", fontSize: size, fontWeight: 800, letterSpacing: ".06em", textAlign: "center" }}>
        {text}
      </span>
    </div>
  );
}

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
