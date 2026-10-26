// The GO button with Stop all and Panic right beside it.
// Buttons use tabIndex -1 so they never keep keyboard focus (Space must always mean GO).

import { useDoc } from "../../store";
import { findCue } from "../../lib/showOps";
import { go, panic, stopAll } from "../../lib/runActions";

export function GoBlock({ standbyId }: { standbyId: string | null }) {
  const standby = useDoc((s) => findCue(s.show, standbyId));
  const stopFade = useDoc((s) => s.show.settings.stopAllFade);
  const ready = !!standby;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 118px", gap: 8, flex: "none" }}>
      <button
        className="b"
        tabIndex={-1}
        onClick={() => void go()}
        style={{
          height: 230, borderRadius: 16, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, padding: 12,
          background: ready ? "var(--gobg)" : "var(--p3)", color: ready ? "var(--ongo)" : "var(--mute)",
        }}
      >
        <span className="cond" style={{ fontSize: 96, fontWeight: 800, lineHeight: 0.85, letterSpacing: ".02em" }}>GO</span>
        <span className="clamp1" style={{ fontSize: 15, fontWeight: 700, maxWidth: "100%" }}>
          {standby ? `${standby.number} ${standby.name}` : "End of show"}
        </span>
        <span className="mono" style={{ fontSize: 11, opacity: 0.7 }}>SPACE · ENTER</span>
      </button>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button className="b cond" tabIndex={-1} onClick={stopAll}
          style={{ flex: 1, borderRadius: 12, background: "var(--p3)", color: "var(--amb)", fontSize: 18, fontWeight: 800, letterSpacing: ".04em" }}>
          STOP ALL
          <span className="mono" style={{ display: "block", fontSize: 10.5, fontWeight: 400, color: "var(--dim)", letterSpacing: 0 }}>fade {stopFade} s · Esc</span>
        </button>
        <button className="b cond" tabIndex={-1} onClick={panic}
          style={{ flex: 1, borderRadius: 12, background: "var(--redbg)", border: "1px solid var(--red)", color: "var(--redtx)", fontSize: 18, fontWeight: 800, letterSpacing: ".04em" }}>
          PANIC
          <span className="mono" style={{ display: "block", fontSize: 10.5, fontWeight: 400, letterSpacing: 0 }}>cut · Esc Esc</span>
        </button>
      </div>
    </div>
  );
}
