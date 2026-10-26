// Thin bar under the top bar: how far through the show we are, with section boundaries.

import { useMemo } from "react";
import { useDoc } from "../store";
import { useEngine } from "../engineStore";
import { fmtTime } from "../lib/format";
import { cueRunLen, mainRunning } from "../lib/showMath";
import { goQueue } from "../types";

export function ShowProgress() {
  const show = useDoc((s) => s.show);
  const playhead = useEngine((s) => s.state?.playhead ?? null);
  const running = useEngine((s) => s.state?.running);

  const { lens, total, sectionStarts } = useMemo(() => {
    const queue = goQueue(show);
    const lens = queue.map((c) => ({ id: c.id, len: cueRunLen(c) }));
    const total = lens.reduce((a, l) => a + l.len, 0);
    // Where each section starts, as a fraction of the show.
    const sectionStarts: number[] = [];
    let acc = 0;
    for (const s of show.sections) {
      if (acc > 0 && total > 0) sectionStarts.push(acc / total);
      for (const c of s.cues) if (!c.attach) acc += cueRunLen(c);
    }
    return { lens, total, sectionStarts };
  }, [show]);

  // Seconds done: everything before the cue that plays now (or before the playhead), plus its elapsed time.
  const cur = mainRunning(running);
  let done = 0;
  const stopAt = cur ? lens.findIndex((l) => l.id === cur.cueId) : playhead ? lens.findIndex((l) => l.id === playhead) : lens.length;
  for (let i = 0; i < (stopAt < 0 ? lens.length : stopAt); i++) done += lens[i].len;
  if (cur) done += (cur.pass - 1) * cur.length + cur.position;
  done = Math.min(done, total);
  const frac = total > 0 ? done / total : 0;

  return (
    <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "0 16px", height: 22, borderBottom: "1px solid var(--line)", background: "var(--bg)" }}>
      <span className="k" style={{ fontSize: 10 }}>Show</span>
      <div style={{ position: "relative", flex: 1, height: 6, background: "var(--p3)", borderRadius: 3, overflow: "hidden" }} aria-label="Show progress">
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${frac * 100}%`, background: "var(--acc)", borderRadius: 3 }} />
        {sectionStarts.map((x, i) => (
          <span key={i} style={{ position: "absolute", top: 0, bottom: 0, left: `${x * 100}%`, width: 2, background: "var(--bg)" }} />
        ))}
      </div>
      <span className="mono" style={{ fontSize: 11.5, color: "var(--dim)", whiteSpace: "nowrap" }}>
        {fmtTime(done)} / {fmtTime(total)} · {fmtTime(total - done)} left
      </span>
    </div>
  );
}
