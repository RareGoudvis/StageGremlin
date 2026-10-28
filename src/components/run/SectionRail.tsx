// Left column in Run: every section, only the current one opened up to show its cues.

import { useDoc } from "../../store";
import { useEngine } from "../../engineStore";
import { goQueue } from "../../types";
import { fmtTime } from "../../lib/format";
import { cueRunLen } from "../../lib/showMath";
import { useT } from "../../i18n";

export function SectionRail({ focusCueId }: { focusCueId: string | null }) {
  const show = useDoc((s) => s.show);
  const t = useT();
  const playhead = useEngine((s) => s.state?.playhead ?? null);
  const runningIds = useEngine((s) => s.state?.running.map((r) => r.cueId).join(",") ?? "");
  const running = new Set(runningIds.split(",").filter(Boolean));

  const queue = goQueue(show).map((c) => c.id);
  const phIdx = playhead ? queue.indexOf(playhead) : queue.length;
  const isPast = (id: string) => queue.indexOf(id) < phIdx && !running.has(id);
  const current = show.sections.find((s) => s.cues.some((c) => c.id === focusCueId)) ?? show.sections[0];

  return (
    <nav aria-label={t("run.sections")} className="scroll" style={{ display: "flex", flexDirection: "column", gap: 4, minHeight: 0, paddingRight: 2 }}>
      <span className="k" style={{ color: "var(--acc)", padding: "2px 4px 6px" }}>{t("run.sections")}</span>
      {show.sections.map((sec) => {
        const cues = sec.cues.filter((c) => !c.attach);
        const len = cues.reduce((a, c) => a + cueRunLen(c), 0);
        const open = sec === current;
        const done = cues.length > 0 && cues.every((c) => isPast(c.id));
        if (!open) {
          return (
            <div key={sec.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 10px", borderRadius: 8, background: done ? "var(--p1)" : "var(--p2)", color: done ? "var(--mute)" : "var(--text)" }}>
              <span className="cond clamp1" style={{ flex: 1, fontSize: 13, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase" }}>{sec.name}</span>
              <span className="mono" style={{ fontSize: 11, color: "var(--mute)" }}>{done ? t("r.rail.done") : `${cues.length} · ${fmtTime(len)}`}</span>
            </div>
          );
        }
        return (
          <div key={sec.id} style={{ display: "flex", flexDirection: "column", gap: 2, padding: 6, borderRadius: 10, background: "var(--p1)", boxShadow: "inset 0 0 0 1px var(--hl)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 4px 6px" }}>
              <span className="cond clamp1" style={{ flex: 1, fontSize: 14, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase" }}>{sec.name}</span>
              <span className="mono" style={{ fontSize: 11, color: "var(--mute)" }}>{fmtTime(len)}</span>
            </div>
            {cues.map((c) => {
              const playing = running.has(c.id);
              const standby = c.id === playhead;
              const past = isPast(c.id);
              return (
                <div key={c.id} style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 7,
                  background: playing ? "var(--p3)" : "transparent",
                  boxShadow: standby ? "inset 0 0 0 1px var(--acc)" : "none",
                  color: past ? "var(--mute)" : "var(--text)",
                }}>
                  <span style={{ width: 4, alignSelf: "stretch", borderRadius: 2, background: past ? "var(--p3)" : c.color ?? "var(--line)" }} />
                  <span className="mono" style={{ fontSize: 12.5, fontWeight: 600, width: 26 }}>{c.number}</span>
                  <span className="clamp1" style={{ flex: 1, fontSize: 13.5, fontWeight: playing || standby ? 700 : 500 }}>{c.name}</span>
                  {playing && <span className="pulse" style={{ width: 8, height: 8, borderRadius: 4, background: "var(--acc)" }} />}
                  {standby && !playing && <span className="k" style={{ color: "var(--acc)", fontSize: 9.5 }}>SB</span>}
                </div>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}
