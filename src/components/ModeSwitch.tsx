// Build / Preflight / Run switch, plus Background a little apart (it's not a step of the show).
// In Run, the other buttons must be held ~1 s (a progress fill shows how long) so a stray click
// can't leave the show screen.

import { useRef, useState } from "react";
import { useDoc, type Mode } from "../store";
import { useT, type TKey } from "../i18n";
import { forceMode, HOLD_TO_LEAVE_MS, requestModeByClick } from "../lib/modeSwitch";

const SHOW_MODES: { mode: Mode; n: string }[] = [
  { mode: "build", n: "1" },
  { mode: "preflight", n: "2" },
  { mode: "run", n: "3" },
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
  const group = { display: "flex", gap: 2, background: "var(--p1)", border: "1px solid var(--line)", borderRadius: 10, padding: 3 } as const;
  const button = (m: Mode, n: string) => (
    <ModeButton key={m} m={m} n={n} mode={mode} holding={holding === m} startHold={startHold} endHold={endHold} preflightOk={preflightOk} />
  );

  return (
    <nav aria-label={t("m.mode.aria")} style={{ display: "flex", gap: 10 }}>
      <div style={group}>{SHOW_MODES.map((x) => button(x.mode, x.n))}</div>
      <div style={group}>{button("background", "4")}</div>
      <style>{`@keyframes holdfill { from { width: 0 } to { width: 100% } }`}</style>
    </nav>
  );
}

function ModeButton({ m, n, mode, holding, startHold, endHold, preflightOk }: {
  m: Mode; n: string; mode: Mode; holding: boolean; preflightOk: boolean;
  startHold: (m: Mode) => void; endHold: () => void;
}) {
  const t = useT();
  const active = mode === m;
  return (
    <button
      className="b cond"
      aria-pressed={active}
      onClick={() => requestModeByClick(m)}
      onPointerDown={() => startHold(m)}
      onPointerUp={endHold}
      onPointerLeave={endHold}
      title={mode === "run" && !active ? t("m.mode.hold") : `${t(`mode.${m}` as TKey)} · Ctrl+${n}`}
      style={{
        position: "relative", overflow: "hidden",
        height: 34, padding: "0 14px", borderRadius: 7, fontSize: 14, fontWeight: 800, letterSpacing: ".06em",
        display: "flex", alignItems: "center", gap: 6,
        // Active Run is lime with dark text; other active modes invert. Never text = background.
        background: active ? (m === "run" ? "var(--gobg)" : "var(--hl)") : "transparent",
        color: active ? (m === "run" ? "var(--ongo)" : "var(--bg)") : "var(--dim)",
      }}
    >
      {holding && (
        <span aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, bottom: 0, background: "var(--p3)", animation: `holdfill ${HOLD_TO_LEAVE_MS}ms linear forwards` }} />
      )}
      <span className="mono tb-mode-num" style={{ fontSize: 11, opacity: 0.7, position: "relative" }}>{n}</span>
      {m === "background" && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true" style={{ position: "relative" }}>
          <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
        </svg>
      )}
      <span className={m === "background" ? "tb-mode-label-bg" : undefined} style={{ position: "relative" }}>{t(`mode.${m}` as TKey)}</span>
      {m === "preflight" && (
        <span style={{ position: "relative", width: 7, height: 7, borderRadius: 4, background: preflightOk ? "var(--acc)" : "var(--amb)" }} />
      )}
    </button>
  );
}
