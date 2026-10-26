// Build / Preflight / Run switch. In Run, the other buttons must be held ~1 s
// (a progress fill shows how long) so a stray click can't leave the show screen.

import { useRef, useState } from "react";
import { useDoc, type Mode } from "../store";
import { useT, type TKey } from "../i18n";
import { forceMode, HOLD_TO_LEAVE_MS, requestModeByClick } from "../lib/modeSwitch";

const MODES: { mode: Mode; n: string; label: string }[] = [
  { mode: "build", n: "1", label: "BUILD" },
  { mode: "preflight", n: "2", label: "PREFLIGHT" },
  { mode: "run", n: "3", label: "RUN" },
];

export function ModeSwitch({ preflightOk }: { preflightOk: boolean }) {
  const mode = useDoc((s) => s.mode);
  const t = useT();
  const [holding, setHolding] = useState<Mode | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const startHold = (m: Mode) => {
    if (mode !== "run" || m === "run") return;
    setHolding(m);
    timer.current = setTimeout(() => {
      setHolding(null);
      forceMode(m);
    }, HOLD_TO_LEAVE_MS);
  };
  const endHold = () => {
    clearTimeout(timer.current);
    setHolding(null);
  };

  return (
    <nav aria-label="Workflow" style={{ display: "flex", gap: 2, background: "var(--p1)", border: "1px solid var(--line)", borderRadius: 10, padding: 3 }}>
      {MODES.map((m) => {
        const active = mode === m.mode;
        return (
          <button
            key={m.mode}
            className="b cond"
            aria-pressed={active}
            onClick={() => requestModeByClick(m.mode)}
            onPointerDown={() => startHold(m.mode)}
            onPointerUp={endHold}
            onPointerLeave={endHold}
            title={mode === "run" && !active ? "Hold to leave Run" : `Ctrl+${m.n}`}
            style={{
              position: "relative", overflow: "hidden",
              height: 34, padding: "0 14px", borderRadius: 7, fontSize: 14, fontWeight: 800, letterSpacing: ".06em",
              display: "flex", alignItems: "center", gap: 6,
              // Active Run is lime with dark text; other active modes invert. Never text = background.
              background: active ? (m.mode === "run" ? "var(--gobg)" : "var(--hl)") : "transparent",
              color: active ? (m.mode === "run" ? "var(--ongo)" : "var(--bg)") : "var(--dim)",
            }}
          >
            {holding === m.mode && (
              <span aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, bottom: 0, background: "var(--p3)", animation: `holdfill ${HOLD_TO_LEAVE_MS}ms linear forwards` }} />
            )}
            <span className="mono" style={{ fontSize: 11, opacity: 0.7, position: "relative" }}>{m.n}</span>
            <span style={{ position: "relative" }}>{t(`mode.${m.mode}` as TKey)}</span>
            {m.mode === "preflight" && (
              <span style={{ position: "relative", width: 7, height: 7, borderRadius: 4, background: preflightOk ? "var(--acc)" : "var(--amb)" }} />
            )}
          </button>
        );
      })}
      <style>{`@keyframes holdfill { from { width: 0 } to { width: 100% } }`}</style>
    </nav>
  );
}
