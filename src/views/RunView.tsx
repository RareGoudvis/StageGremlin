// Run: the show screen. Fits one screen, nothing to edit.
//   left   section rail (only the current section opened)
//   middle now-playing card + up next
//   right  GO with Stop all / Panic, then the dock (Pads / Background / Log)
//
// Keys (only here): Space/Enter GO · Esc Stop all · Esc Esc Panic · S stop · U under ·
// V release vamp · ↑/↓ move the up-next selection · Ctrl+K find · H preview the selected row ·
// D / R duck / restore background · Shift+D play/pause it · Shift+→ next track (Alt: no fade) ·
// 1–9, 0 pads. Big mode (Ctrl+B) shows only GO, now playing and next.

import { useEffect, useRef, useState } from "react";
import { useDoc } from "../store";
import { useEngine } from "../engineStore";
import { toast, useUi } from "../uiStore";
import { goQueue } from "../types";
import { findCue } from "../lib/showOps";
import { previewStop, previewToggle, usePreview } from "../lib/preview";
import { fmtTime } from "../lib/format";
import { mainRunning } from "../lib/showMath";
import { firePadByKey, go, panic, pauseAll, releaseVamp, stopAll, stopCue, toggleUnder } from "../lib/runActions";
import { isAction } from "../settingsStore";
import { SectionRail } from "../components/run/SectionRail";
import { NowPlaying } from "../components/run/NowPlaying";
import { UpNext, upNextCues } from "../components/run/UpNext";
import { GoBlock } from "../components/run/GoBlock";
import { Dock } from "../components/run/Dock";
import { backgroundKey } from "../components/background/useBackground";

const DOUBLE_ESC_MS = 500;

export function RunView() {
  const playhead = useEngine((s) => s.state?.playhead ?? null);
  const running = useEngine((s) => s.state?.running);
  const [focusInstance, setFocusInstance] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const big = useUi((s) => s.booth.big);

  // The card follows the cue the operator clicked in "Also playing", else the most recent one.
  const run = running?.find((r) => r.instance === focusInstance && !r.padId) ?? mainRunning(running);

  // Latest values for the key handler (it is registered once).
  const live = useRef({ run, playhead, selectedId, searchOpen, search });
  live.current = { run, playhead, selectedId, searchOpen, search };

  useEffect(() => {
    let lastEsc = 0;

    const onKeyDown = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      if (ui.confirm || ui.dialog) return; // a dialog has the keyboard
      const { run, playhead, selectedId, searchOpen, search } = live.current;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (searchOpen) {
        // While searching, Space types and Esc only closes the search.
        if (e.key === "Escape") {
          e.preventDefault();
          setSearchOpen(false);
          setSearch("");
        }
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === " " || e.key === "Enter") {
        // Never let Space/Enter click a focused button: it must mean GO.
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur?.();
        if (!e.repeat) void go();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        // Esc also stops a headphone preview (it never plays in the hall anyway).
        if (usePreview.getState().state?.playing) void previewStop();
        const now = performance.now();
        if (now - lastEsc < DOUBLE_ESC_MS) {
          panic();
          lastEsc = 0;
        } else {
          stopAll();
          lastEsc = now;
        }
        return;
      }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const list = upNextCues(goQueue(useDoc.getState().show), playhead, searchOpen ? search : "");
        if (!list.length) return;
        const i = selectedId ? list.findIndex((c) => c.id === selectedId) : -1;
        const j = Math.max(0, Math.min(list.length - 1, i + (e.key === "ArrowUp" ? -1 : 1)));
        setSelectedId(list[j].id);
        return;
      }
      // Pads: keys 1–9 and 0 (also the number pad).
      if (/^[0-9]$/.test(e.key)) {
        if (firePadByKey(e.key)) e.preventDefault();
        return;
      }
      // Background music: D duck · R restore · Shift+D play/pause · Shift+→ next · Alt = no fade.
      // These work even when the dock is locked (the lock only guards against mis-taps).
      if (backgroundKey(e)) {
        e.preventDefault();
        return;
      }
      const k = e.key.toLowerCase();
      // P: pause / resume everything (rebindable in Settings).
      if (isAction(e, "pauseAll")) {
        e.preventDefault();
        pauseAll();
        return;
      }
      if (k === "h") {
        e.preventDefault();
        const c = findCue(useDoc.getState().show, selectedId ?? playhead);
        if (c) previewToggle(c);
        return;
      }
      if (k === "s" && run) { e.preventDefault(); stopCue(run.cueId); }
      else if (k === "u") { e.preventDefault(); toggleUnder(run?.cueId ?? null); }
      else if (k === "v") { e.preventDefault(); releaseVamp(run?.cueId ?? null); }
    };

    // Space activates buttons on key-up; swallow that too.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " " && !live.current.searchOpen && !useUi.getState().confirm) e.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, []);

  if (big) return <BigRun run={run} playhead={playhead} />;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
    <RehearsalStrip />
    <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "240px minmax(0, 1fr) 400px", gap: 12, padding: "10px 14px 12px" }}>
      <SectionRail focusCueId={run?.cueId ?? playhead} />
      <div style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
        <NowPlaying run={run} standbyId={playhead} onFocus={setFocusInstance} />
        <UpNext
          playhead={playhead}
          selectedId={selectedId}
          onSelect={setSelectedId}
          search={search}
          setSearch={setSearch}
          searchOpen={searchOpen}
          closeSearch={() => { setSearchOpen(false); setSearch(""); }}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
        <GoBlock standbyId={playhead} />
        <Dock />
      </div>
    </div>
    </div>
  );
}

/** Rehearsal toggle, badge and "use measured times as plan". */
function RehearsalStrip() {
  const on = useEngine((s) => s.rehearsal);
  const measuredCount = useEngine((s) => Object.keys(s.measured).length);
  const hasPlan = useEngine((s) => s.plan !== null);
  const { setRehearsal, adoptPlan, clearPlan } = useEngine.getState();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px 0", flexWrap: "wrap" }}>
      <button className="b chip" tabIndex={-1} aria-pressed={on} onClick={() => setRehearsal(!on)}
        style={on ? { background: "var(--amb)", color: "var(--onamb)" } : undefined}>
        {on ? "REHEARSAL ON" : "Rehearsal"}
      </button>
      {on && (
        <span style={{ fontSize: 13, color: "var(--ambtx)" }}>
          Start any cue from its start or a marker; the log marks these lines REH and the real durations are measured.
        </span>
      )}
      {!on && measuredCount > 0 && (
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, color: "var(--dim)" }}>{measuredCount} cue{measuredCount > 1 ? "s" : ""} measured in rehearsal.</span>
          <button className="b btn" tabIndex={-1} style={{ height: 28 }} onClick={() => { adoptPlan(); toast("Rehearsal times are now the plan"); }}>Use measured times as plan</button>
        </span>
      )}
      {hasPlan && <button className="b btn btn-ghost" tabIndex={-1} style={{ height: 28 }} onClick={clearPlan}>Forget plan</button>}
    </div>
  );
}

/** Big mode: only GO, what's playing and what's next, as large as possible. */
function BigRun({ run, playhead }: { run: ReturnType<typeof mainRunning>; playhead: string | null }) {
  const show = useDoc((s) => s.show);
  const now = run ? findCue(show, run.cueId) : null;
  const next = findCue(show, playhead);
  return (
    <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) 420px", gap: 16, padding: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 0 }}>
        <div style={{ flex: 1, borderRadius: 18, background: "var(--p1)", border: `1px solid ${run ? "var(--acc)" : "var(--line)"}`, padding: "24px 28px", display: "flex", flexDirection: "column", gap: 14, justifyContent: "center", minHeight: 0 }}>
          <span className="k" style={{ color: run ? "var(--acc)" : undefined }}>{run ? "Now playing" : "Silence"}</span>
          <span className="cond clamp1" style={{ fontSize: 72, fontWeight: 800, lineHeight: 1 }}>
            <span className="mono" style={{ color: "var(--acc)", fontSize: 56 }}>{now?.number ?? ""}</span> {now?.name ?? "—"}
          </span>
          {run && <span className="mono" style={{ fontSize: 110, fontWeight: 600, lineHeight: 1 }}>−{fmtTime(run.remaining)}</span>}
          {now?.notes.sound && <span style={{ fontSize: 26, color: "var(--ambtx)" }}>{now.notes.sound}</span>}
        </div>
        <div style={{ borderRadius: 18, background: "var(--p2)", padding: "18px 24px", display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="k" style={{ color: "var(--acc)" }}>Standby</span>
          <span className="cond clamp1" style={{ fontSize: 40, fontWeight: 800 }}><span className="mono" style={{ fontSize: 30 }}>{next?.number ?? ""}</span> {next?.name ?? "End of show"}</span>
          {next?.notes.sound && <span style={{ fontSize: 20, color: "var(--ambtx)" }}>{next.notes.sound}</span>}
          {next?.notes.lx && <span style={{ fontSize: 18, color: "var(--lx)" }}>LX · {next.notes.lx}</span>}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <BigGo ready={!!next} />
        <span className="mono" style={{ fontSize: 12, color: "var(--mute)", textAlign: "center" }}>Ctrl+B leaves Big mode</span>
      </div>
    </div>
  );
}

function BigGo({ ready }: { ready: boolean }) {
  return (
    <>
      <button className="b" tabIndex={-1} onClick={() => void go()}
        style={{ flex: 1, borderRadius: 22, background: ready ? "var(--gobg)" : "var(--p3)", color: ready ? "var(--ongo)" : "var(--mute)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span className="cond" style={{ fontSize: 150, fontWeight: 800, lineHeight: 0.9 }}>GO</span>
      </button>
      <button className="b cond" tabIndex={-1} onClick={stopAll} style={{ height: 90, borderRadius: 14, background: "var(--p3)", color: "var(--amb)", fontSize: 26, fontWeight: 800 }}>STOP ALL</button>
      <button className="b cond" tabIndex={-1} onClick={panic} style={{ height: 90, borderRadius: 14, background: "var(--redbg)", border: "2px solid var(--red)", color: "var(--redtx)", fontSize: 26, fontWeight: 800 }}>PANIC</button>
    </>
  );
}
