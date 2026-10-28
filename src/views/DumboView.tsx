// Dumbo mode ("Dumbo-modus"): a Run screen for someone who has never run sound.
// What plays now (timeline + big time left), what's next (its length, its sound note, "starts by itself"
// when it follows), the rest of the show after it (read only), one huge GO and STOP ALL.
// Pads only when switched on in Settings. Long names wrap instead of being cut off. Only GO, Stop all (twice = Panic) and pad keys work.
// Leaving: hold the small corner button for 3 s, or type the PIN when one is set in Settings.

import { useEffect, useRef, useState } from "react";
import { setLocalOverlay } from "../lib/emergencyKeys";
import { useDoc } from "../store";
import { useEngine } from "../engineStore";
import { useUi } from "../uiStore";
import { useSettings, isAction } from "../settingsStore";
import { tr, useT } from "../i18n";
import { findCue } from "../lib/showOps";
import { mainRunning } from "../lib/showMath";
import { firePad, firePadByKey, go, panic, stopAll } from "../lib/runActions";
import { fmtTime } from "../lib/format";
import { trimmedLen } from "../types";
import { LaterList } from "../components/run/CueInfo";
import { GoLockBar, useGoLocked } from "../components/run/GoLock";

const DOUBLE_ESC_MS = 500;
const HOLD_MS = 3000;

export function DumboView() {
  const t = useT();
  const show = useDoc((s) => s.show);
  const playhead = useEngine((s) => s.state?.playhead ?? null);
  const running = useEngine((s) => s.state?.running);
  const padRunning = useEngine((s) => s.state?.running.filter((r) => r.padId).map((r) => r.padId).join(",") ?? "");
  const showPads = useSettings((s) => s.ui.dumboPads);
  const pin = useSettings((s) => s.ui.dumboPin);
  const [askPin, setAskPin] = useState(false);

  const run = mainRunning(running);
  const now = run ? findCue(show, run.cueId) : null;
  const next = findCue(show, playhead);
  const pads = showPads ? show.pads.filter((p) => p.hotkey) : [];

  // The keyboard: GO, Stop all (twice = Panic), pads. Everything else is swallowed.
  // The PIN prompt counts as "something open": Esc closes it, Esc Esc still panics.
  useEffect(() => {
    setLocalOverlay("dumbo-pin", askPin);
    return () => setLocalOverlay("dumbo-pin", false);
  }, [askPin]);
  const live = useRef({ askPin, showPads });
  live.current = { askPin, showPads };
  useEffect(() => {
    let lastEsc = 0;
    const onKey = (e: KeyboardEvent) => {
      if (live.current.askPin) return; // typing the PIN
      e.stopImmediatePropagation();
      if (e.key === "Tab" || e.key.startsWith("F") && e.key.length > 1) return; // let the OS keys be
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur?.();
      if (isAction(e, "go") || isAction(e, "goAlt")) {
        if (!e.repeat) void go();
      } else if (isAction(e, "stopAll")) {
        const n = performance.now();
        if (n - lastEsc < DOUBLE_ESC_MS) { panic(); lastEsc = 0; } else { stopAll(); lastEsc = n; }
      } else if (live.current.showPads && !e.ctrlKey && !e.altKey && /^[0-9]$/.test(e.key)) {
        firePadByKey(e.key);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => { if (!live.current.askPin) { e.preventDefault(); e.stopImmediatePropagation(); } };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, []);

  const leave = () => {
    useSettings.getState().update({ dumbo: false });
    useUi.getState().showToast(tr("i.dumbo.off"));
  };

  // Next starts by itself when what plays now has a follow: then the helper must NOT press GO.
  const autoNext = !!now && !!next && now.follow.kind !== "none";
  const nextLen = next ? trimmedLen(next) : null;
  const locked = useGoLocked();
  const twoLines = { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" } as const;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, 1fr)", gridTemplateRows: `minmax(0, 1fr)${pads.length ? " auto" : ""}`, gap: 18, padding: 18 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 18, minHeight: 0 }}>
        {/* What plays now: name, a big timeline, and the time left. */}
        <section style={{ flex: "none", borderRadius: 20, background: "var(--p1)", border: `2px solid ${run ? "var(--acc)" : "var(--line)"}`, padding: "20px 28px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 12 }}>
          <span className="k" style={{ fontSize: 14, color: run ? "var(--acc)" : undefined }}>{run ? t("dumbo.now") : t("dumbo.nothing")}</span>
          {now && <span className="cond" style={{ fontSize: 44, fontWeight: 800, lineHeight: 1.05, ...twoLines }}>{now.name}</span>}
          {run && <Timeline position={run.position} length={run.length} big />}
        </section>
        {/* What GO plays next, its length as an empty timeline, and its sound note. */}
        <section style={{ flex: "none", borderRadius: 20, background: "var(--p2)", padding: "20px 28px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 12 }}>
          <span className="k" style={{ fontSize: 14, color: "var(--acc)" }}>{t("dumbo.next")}</span>
          <span className="cond" style={{ fontSize: 44, fontWeight: 800, lineHeight: 1.05, ...twoLines }}>{next ? next.name : t("dumbo.end")}</span>
          {next && nextLen != null && <Timeline position={0} length={nextLen} />}
          {autoNext && <span style={{ fontSize: 22, fontWeight: 700, color: "var(--acc)" }}>{t("i.dumbo.auto")}</span>}
          {next?.notes.sound && <span style={{ fontSize: 24, lineHeight: 1.25, color: "var(--ambtx)" }}>{next.notes.sound}</span>}
        </section>
        {/* Everything still to come after "next", so the helper sees the whole rest of the show. */}
        <div style={{ flex: 1, minHeight: 120, display: "flex" }}>
          <LaterList standbyId={playhead} scale={1.2} />
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: 0 }}>
        <button className="b" tabIndex={-1} onClick={() => void go()}
          style={{ flex: 1, borderRadius: 26, background: next ? "var(--gobg)" : "var(--p3)", color: next ? "var(--ongo)" : "var(--mute)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, position: "relative", overflow: "hidden", opacity: locked ? 0.55 : 1 }}>
          <GoLockBar />
          <span className="cond" style={{ fontSize: "min(22vh, 220px)", fontWeight: 800, lineHeight: 0.85 }}>{t("go")}</span>
          <span style={{ fontSize: 22, fontWeight: 700, padding: "0 16px", textAlign: "center" }}>{t("dumbo.hint")}</span>
        </button>
        <button className="b cond" tabIndex={-1} onClick={stopAll}
          style={{ height: 120, borderRadius: 18, background: "var(--redbg)", border: "2px solid var(--red)", color: "var(--redtx)", fontSize: 40, fontWeight: 800, letterSpacing: ".04em" }}>
          {t("stopAll")}
          <span className="mono" style={{ display: "block", fontSize: 13, fontWeight: 400, letterSpacing: 0 }}>Esc</span>
        </button>
      </div>

      {pads.length > 0 && (
        <div style={{ gridColumn: "1 / -1", display: "grid", gridTemplateColumns: `repeat(${Math.min(pads.length, 10)}, minmax(0, 1fr))`, gap: 10 }}>
          {pads.map((p) => {
            const on = padRunning.split(",").includes(p.id);
            const color = p.cue.color ?? "var(--acc)";
            return (
              <button key={p.id} className="b" tabIndex={-1} onClick={() => firePad(p.id)}
                style={{ height: 84, borderRadius: 14, padding: "8px 12px", textAlign: "left", display: "flex", flexDirection: "column", justifyContent: "space-between", background: on ? color : "var(--p2)", color: on ? "var(--oncue)" : "var(--text)", boxShadow: on ? `0 0 0 2px ${color}` : `inset 5px 0 0 ${color}` }}>
                <span className="mono" style={{ fontSize: 16, fontWeight: 600 }}>{p.hotkey}</span>
                <span className="clamp1" style={{ fontSize: 17, fontWeight: 700 }}>{p.cue.name}</span>
              </button>
            );
          })}
        </div>
      )}

      <LeaveButton onLeave={leave} pin={pin} askPin={askPin} setAskPin={setAskPin} />
    </div>
  );
}

/** A cue's timeline: a bar that fills as it plays, time played on the left, time left on the right. */
function Timeline({ position, length, big }: { position: number; length: number; big?: boolean }) {
  const pct = length > 0 ? Math.min(100, Math.max(0, (position / length) * 100)) : 0;
  const left = Math.max(0, length - position);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ height: big ? 22 : 12, borderRadius: 11, background: "var(--p3)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "var(--acc)", transition: "width .1s linear" }} />
      </div>
      <div className="mono" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", color: "var(--dim)", fontSize: big ? 22 : 18 }}>
        <span>{fmtTime(position)}</span>
        <span style={big ? { fontSize: 88, fontWeight: 600, lineHeight: 1, color: "var(--text)" } : undefined}>{big ? `−${fmtTime(left)}` : fmtTime(length)}</span>
      </div>
    </div>
  );
}

/** Small corner button: hold 3 s (a ring fills) — or, with a PIN, opens a PIN box. */
function LeaveButton({ onLeave, pin, askPin, setAskPin }: { onLeave: () => void; pin: string; askPin: boolean; setAskPin: (v: boolean) => void }) {
  const t = useT();
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [typed, setTyped] = useState("");
  const [wrong, setWrong] = useState(false);

  const start = () => {
    if (pin) return setAskPin(true);
    setHolding(true);
    timer.current = setTimeout(() => { setHolding(false); onLeave(); }, HOLD_MS);
  };
  const stop = () => { clearTimeout(timer.current); setHolding(false); };
  const R = 15;
  const C = 2 * Math.PI * R;

  return (
    <>
      <button className="b" tabIndex={-1} aria-label={pin ? t("dumbo.pin") : t("dumbo.leave")} title={pin ? t("dumbo.pin") : t("dumbo.leave")}
        onPointerDown={start} onPointerUp={stop} onPointerLeave={stop}
        style={{ position: "fixed", left: 4, top: 4, width: 40, height: 40, borderRadius: 20, padding: 0, background: "transparent", opacity: holding ? 1 : 0.45, zIndex: 40 }}>
        <svg width={40} height={40} viewBox="0 0 40 40" aria-hidden="true">
          <circle cx={20} cy={20} r={R} fill="var(--p2)" stroke="var(--line)" strokeWidth={3} />
          <circle cx={20} cy={20} r={R} fill="none" stroke="var(--amb)" strokeWidth={3} strokeDasharray={C} strokeDashoffset={holding ? 0 : C}
            transform="rotate(-90 20 20)" style={{ transition: holding ? `stroke-dashoffset ${HOLD_MS}ms linear` : "none" }} />
          <path d="M15 15l10 10M25 15L15 25" stroke="var(--dim)" strokeWidth={2} strokeLinecap="round" />
        </svg>
      </button>
      {askPin && (
        <div className="scrim" style={{ zIndex: 80 }}>
          <div className="dialog" role="dialog" aria-label={t("dumbo.pin")} style={{ maxWidth: 360 }}>
            <span style={{ fontSize: 16, fontWeight: 700 }}>{t("dumbo.pin")}</span>
            <input className="input mono" autoFocus inputMode="numeric" maxLength={4} value={typed} aria-label="PIN"
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "").slice(0, 4);
                setTyped(v);
                setWrong(false);
                if (v.length === 4) {
                  if (v === pin) { setAskPin(false); onLeave(); }
                  else { setWrong(true); setTyped(""); }
                }
              }}
              onKeyDown={(e) => e.key === "Escape" && (setAskPin(false), setTyped(""))}
              style={{ height: 52, fontSize: 30, letterSpacing: ".5em", textAlign: "center" }} />
            {wrong && <span style={{ color: "var(--redtx)", fontSize: 13 }}>{t("dumbo.wrong")}</span>}
            <button className="b btn" onClick={() => { setAskPin(false); setTyped(""); }}>{t("cancel")}</button>
          </div>
        </div>
      )}
    </>
  );
}
