// Run dock → Background tab. Kept visibly apart from the show: its own colour (cyan) and border.
// Locked by default so a stray tap can't change the music mid-show; hold "Unlock" for 1 s.
// Auto-duck (Rust side) keeps working while locked. Stop all / Panic never touch the background.
// Hold Alt while clicking Duck / Restore / Play / Pause to do it instantly (no fade).

import { useEffect, useRef, useState } from "react";
import { bg, bgDo, SOURCES, useBackground, type BgCmd, type BgSource } from "./useBackground";

const HOLD_MS = 1000;
/** Re-lock by itself after this long without a touch, so it is never left open by accident. */
const RELOCK_MS = 30_000;

export function BackgroundDock() {
  const st = useBackground();
  const [locked, setLocked] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const lastTouch = useRef(Date.now());

  useEffect(() => {
    if (locked) return;
    const t = window.setInterval(() => {
      if (Date.now() - lastTouch.current > RELOCK_MS) setLocked(true);
    }, 1000);
    return () => window.clearInterval(t);
  }, [locked]);

  const touch = () => { lastTouch.current = Date.now(); };
  const run = (c: BgCmd, e?: React.MouseEvent) => {
    touch();
    bgDo(bg.command(c, Boolean(e?.altKey)), setErr);
  };

  const pos = st?.position ?? null;
  const dur = st?.duration ?? null;
  const frac = pos != null && dur ? Math.min(1, pos / dur) : 0;
  const error = st?.error ?? err;

  return (
    <div style={{ flex: 1, minHeight: 0, margin: 6, borderRadius: 10, border: "2px solid var(--cyline)", background: "var(--cybg)", color: "var(--cytx)", display: "flex", flexDirection: "column", gap: 8, padding: 10 }} className="scroll">
      {/* Header: source + lock */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="k" style={{ color: "var(--cy)" }}>Background</span>
        <select
          className="select"
          aria-label="Background source"
          disabled={locked}
          value={st?.source ?? ""}
          onChange={(e) => { touch(); bgDo(bg.open(e.target.value as BgSource, false), setErr); }}
          style={{ height: 28, fontSize: 12.5, flex: 1, minWidth: 0 }}
        >
          <option value="" disabled>Pick a source…</option>
          {SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <LockButton locked={locked} onUnlock={() => { touch(); setLocked(false); }} onLock={() => setLocked(true)} />
      </div>

      {/* Now playing */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div className="clamp1" style={{ fontSize: 15, fontWeight: 700, color: "var(--cytx)" }}>
          {st?.title ?? (st?.open ? "Nothing playing" : "Player not open")}
        </div>
        <div className="clamp1" style={{ fontSize: 12.5, color: "var(--cydim)" }}>
          {st?.artist ?? (st?.open ? "" : "Open it in Build › Background, or pick a source here")}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="mono" style={{ fontSize: 12, color: "var(--cydim)" }}>{fmt(pos)}</span>
          <div style={{ flex: 1, height: 4, borderRadius: 2, background: "var(--cybtn)", overflow: "hidden" }}>
            <div style={{ width: `${frac * 100}%`, height: "100%", background: "var(--cy)" }} />
          </div>
          <span className="mono" style={{ fontSize: 12, color: "var(--cydim)" }}>{fmt(dur)}</span>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span className="tag tag-cy">{st?.playing ? "PLAYING" : "PAUSED"}</span>
          {st?.ducked && <span className="tag tag-amb">DUCKED</span>}
        </div>
      </div>

      {/* Buttons */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        <CyButton disabled={locked} onClick={(e) => run(st?.ducked ? "restore" : "duck", e)} strong>
          {st?.ducked ? "Restore" : "Duck"}
        </CyButton>
        <CyButton disabled={locked} onClick={(e) => run(st?.playing ? "pause" : "play", e)}>
          {st?.playing ? "Pause" : "Play"}
        </CyButton>
        <CyButton disabled={locked} onClick={(e) => run("prev", e)}>◀◀ Prev</CyButton>
        <CyButton disabled={locked} onClick={(e) => run("next", e)}>Next ▶▶</CyButton>
      </div>

      {/* Level */}
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
        <span style={{ color: "var(--cydim)", width: 38 }}>Level</span>
        <input
          type="range" min={-40} max={0} step={0.5}
          disabled={locked}
          value={st?.levelDb ?? 0}
          onChange={(e) => { touch(); bgDo(bg.setLevel(Number(e.target.value)), setErr); }}
          style={{ accentColor: "var(--cy)" }}
          aria-label="Background level"
        />
        <span className="mono" style={{ width: 52, textAlign: "right" }}>{(st?.levelDb ?? 0).toFixed(1)} dB</span>
      </label>

      {st?.open && !st.sessionFound && (
        <div style={{ fontSize: 12, padding: "6px 8px", borderRadius: 6, background: "var(--ambbg)", color: "var(--ambtx)" }}>
          Windows volume control not found yet: Duck and fades won't work until the player has played a few seconds.
        </div>
      )}
      {error && (
        <div style={{ fontSize: 12, padding: "6px 8px", borderRadius: 6, background: "var(--redbg)", color: "var(--redtx)" }}>{error}</div>
      )}
    </div>
  );
}

function LockButton({ locked, onUnlock, onLock }: { locked: boolean; onUnlock: () => void; onLock: () => void }) {
  const [progress, setProgress] = useState(0);
  const timer = useRef<number | null>(null);
  const start = useRef(0);

  const cancel = () => {
    if (timer.current != null) window.clearInterval(timer.current);
    timer.current = null;
    setProgress(0);
  };
  const begin = () => {
    if (!locked) { onLock(); return; }
    start.current = Date.now();
    timer.current = window.setInterval(() => {
      const p = (Date.now() - start.current) / HOLD_MS;
      if (p >= 1) { cancel(); onUnlock(); } else setProgress(p);
    }, 30);
  };
  useEffect(() => cancel, []);

  return (
    <button
      className="b btn"
      tabIndex={-1}
      onPointerDown={begin}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      title={locked ? "Hold 1 s to unlock" : "Lock"}
      style={{ position: "relative", overflow: "hidden", height: 28, fontSize: 12, background: locked ? "var(--cybtn)" : "var(--cy)", color: locked ? "var(--cytx)" : "var(--oncy)", fontWeight: 800 }}
    >
      <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${progress * 100}%`, background: "var(--cy)", opacity: 0.45 }} />
      <span style={{ position: "relative" }}>{locked ? "Hold to unlock" : "Lock"}</span>
    </button>
  );
}

function CyButton({ children, onClick, disabled, strong }: { children: React.ReactNode; onClick: (e: React.MouseEvent) => void; disabled?: boolean; strong?: boolean }) {
  return (
    <button
      className="b btn"
      tabIndex={-1} // Space is GO in Run: never let a dock button keep the focus
      disabled={disabled}
      onClick={onClick}
      style={{ justifyContent: "center", height: 36, background: strong ? "var(--cy)" : "var(--cybtn)", color: strong ? "var(--oncy)" : "var(--cytx)", fontWeight: 800 }}
    >
      {children}
    </button>
  );
}

function fmt(s: number | null): string {
  if (s == null || !isFinite(s)) return "--:--";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}
