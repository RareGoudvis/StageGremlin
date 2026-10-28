// Run: the show screen. Fits one screen, nothing to edit.
//   left   section rail (only the current section opened)
//   middle now-playing card + up next
//   right  GO with Stop all / Panic, then the dock (Pads / Background / Log)
//
// Keys (only here; all rebindable in Settings › Shortcuts): Space/Enter GO · Esc Stop all · Esc Esc Panic · S stop · U under ·
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
import { isAction, type Action } from "../settingsStore";
import { useMenu } from "../components/ContextMenu";
import { SectionRail } from "../components/run/SectionRail";
import { NowPlaying } from "../components/run/NowPlaying";
import { UpNext, upNextCues } from "../components/run/UpNext";
import { GoBlock } from "../components/run/GoBlock";
import { Dock } from "../components/run/Dock";
import { bg, bgDo } from "../components/background/useBackground";
import { setLocalOverlay } from "../lib/emergencyKeys";
import { RunDialogArea } from "../components/RunDialogHost";
import { tr, useT } from "../i18n";

const DOUBLE_ESC_MS = 500;

export function RunView() {
  const playhead = useEngine((s) => s.state?.playhead ?? null);
  const running = useEngine((s) => s.state?.running);
  const [focusInstance, setFocusInstance] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const big = useUi((s) => s.booth.big);
  // The search box counts as "something open": Esc closes it instead of stopping everything.
  useEffect(() => {
    setLocalOverlay("run-search", searchOpen);
    return () => setLocalOverlay("run-search", false);
  }, [searchOpen]);

  // The card follows the cue the operator clicked in "Also playing", else the most recent one.
  const run = running?.find((r) => r.instance === focusInstance && !r.padId) ?? mainRunning(running);

  // Latest values for the key handler (it is registered once).
  const live = useRef({ run, playhead, selectedId, searchOpen, search });
  live.current = { run, playhead, selectedId, searchOpen, search };

  useEffect(() => {
    let lastEsc = 0;

    const onKeyDown = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      // A dialog or a right-click menu has the keyboard.
      if (ui.confirm || ui.dialog || useMenu.getState().menu) return;
      const { run, playhead, selectedId, searchOpen, search } = live.current;
      // Every key below comes from the keymap (Settings › Shortcuts), except ↑/↓ and the pad digits.
      const hit = (a: Action, opts?: { ignoreAlt?: boolean }) => isAction(e, a, opts);

      if (hit("find")) {
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

      if (hit("go") || hit("goAlt")) {
        // Never let Space/Enter click a focused button: it must mean GO.
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur?.();
        if (!e.repeat) void go();
        return;
      }
      // Stop all / Panic are handled first, by lib/emergencyKeys.ts (they must work through dialogs too);
      // this branch only remains as a fallback.
      if (hit("stopAll")) {
        e.preventDefault();
        // It also stops a headphone preview (that never plays in the hall anyway).
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
      if (e.ctrlKey || e.metaKey) return; // the rest are plain keys
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
      if (!e.altKey && /^[0-9]$/.test(e.key)) {
        if (firePadByKey(e.key)) e.preventDefault();
        return;
      }
      // Background music (Alt = without fade). They work even when the dock is locked.
      const instant = e.altKey;
      if (hit("bgDuck", { ignoreAlt: true })) { e.preventDefault(); bgDo(bg.command("duck", instant)); return; }
      if (hit("bgRestore", { ignoreAlt: true })) { e.preventDefault(); bgDo(bg.command("restore", instant)); return; }
      if (hit("bgNext", { ignoreAlt: true })) { e.preventDefault(); bgDo(bg.command("next", instant)); return; }
      if (hit("bgPlayPause", { ignoreAlt: true })) {
        e.preventDefault();
        // Play/pause toggles, so ask what it is doing right now (the dock may not be open).
        bgDo(bg.getState().then((st) => bg.command(st.playing ? "pause" : "play", instant)));
        return;
      }
      if (hit("pauseAll")) { e.preventDefault(); pauseAll(); return; }
      if (hit("preview")) {
        e.preventDefault();
        const c = findCue(useDoc.getState().show, selectedId ?? playhead);
        if (c) previewToggle(c);
        return;
      }
      if (hit("stopCue") && run) { e.preventDefault(); stopCue(run.cueId); }
      else if (hit("under")) { e.preventDefault(); toggleUnder(run?.cueId ?? null); }
      else if (hit("releaseVamp")) { e.preventDefault(); releaseVamp(run?.cueId ?? null); }
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
    <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "240px minmax(0, 1fr) 400px", gap: 12, padding: "10px 14px 12px", position: "relative" }}>
      {/* Bigger dialogs (Swap, Settings) open over the rail + middle; the GO column stays free. */}
      <div style={{ position: "absolute", top: 10, left: 14, bottom: 12, right: 14 + 400 + 12, pointerEvents: "none", zIndex: 60 }}>
        <RunDialogArea name="main" />
      </div>
      <SectionRail focusCueId={run?.cueId ?? playhead} />
      <div style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
        <NowPlaying run={run} standbyId={playhead} onFocus={setFocusInstance} />
        {/* Small dialogs (Make next) open over the up-next list only. */}
        <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <RunDialogArea name="list" />
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
  const t = useT();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px 0", flexWrap: "wrap" }}>
      <button className="b chip" tabIndex={-1} aria-pressed={on} onClick={() => setRehearsal(!on)}
        style={on ? { background: "var(--amb)", color: "var(--onamb)" } : undefined}>
        {on ? t("r.reh.on") : t("r.reh.off")}
      </button>
      {on && (
        <span style={{ fontSize: 13, color: "var(--ambtx)" }}>
          {t("r.reh.explain")}
        </span>
      )}
      {!on && measuredCount > 0 && (
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, color: "var(--dim)" }}>{measuredCount > 1 ? t("r.reh.measuredN", { n: measuredCount }) : t("r.reh.measured1")}</span>
          <button className="b btn" tabIndex={-1} style={{ height: 28 }} onClick={() => { adoptPlan(); toast(tr("r.reh.adopted")); }}>{t("r.reh.adopt")}</button>
        </span>
      )}
      {hasPlan && <button className="b btn btn-ghost" tabIndex={-1} style={{ height: 28 }} onClick={clearPlan}>{t("r.reh.forget")}</button>}
    </div>
  );
}

/** Big mode: only GO, what's playing and what's next, as large as possible. */
function BigRun({ run, playhead }: { run: ReturnType<typeof mainRunning>; playhead: string | null }) {
  const show = useDoc((s) => s.show);
  const t = useT();
  const now = run ? findCue(show, run.cueId) : null;
  const next = findCue(show, playhead);
  return (
    <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) 420px", gap: 16, padding: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 0 }}>
        <div style={{ flex: 1, borderRadius: 18, background: "var(--p1)", border: `1px solid ${run ? "var(--acc)" : "var(--line)"}`, padding: "24px 28px", display: "flex", flexDirection: "column", gap: 14, justifyContent: "center", minHeight: 0 }}>
          <span className="k" style={{ color: run ? "var(--acc)" : undefined }}>{run ? t("run.nowPlaying") : t("r.silence")}</span>
          <span className="cond clamp1" style={{ fontSize: 72, fontWeight: 800, lineHeight: 1 }}>
            <span className="mono" style={{ color: "var(--acc)", fontSize: 56 }}>{now?.number ?? ""}</span> {now?.name ?? "—"}
          </span>
          {run && <span className="mono" style={{ fontSize: 110, fontWeight: 600, lineHeight: 1 }}>−{fmtTime(run.remaining)}</span>}
          {now?.notes.sound && <span style={{ fontSize: 26, color: "var(--ambtx)" }}>{now.notes.sound}</span>}
        </div>
        <div style={{ borderRadius: 18, background: "var(--p2)", padding: "18px 24px", display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="k" style={{ color: "var(--acc)" }}>{t("run.standby")}</span>
          <span className="cond clamp1" style={{ fontSize: 40, fontWeight: 800 }}><span className="mono" style={{ fontSize: 30 }}>{next?.number ?? ""}</span> {next?.name ?? t("run.endOfShow")}</span>
          {next?.notes.sound && <span style={{ fontSize: 20, color: "var(--ambtx)" }}>{next.notes.sound}</span>}
          {next?.notes.lx && <span style={{ fontSize: 18, color: "var(--lx)" }}>LX · {next.notes.lx}</span>}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <BigGo ready={!!next} />
        <span className="mono" style={{ fontSize: 12, color: "var(--mute)", textAlign: "center" }}>{t("r.big.leave")}</span>
      </div>
    </div>
  );
}

function BigGo({ ready }: { ready: boolean }) {
  const t = useT();
  return (
    <>
      <button className="b" tabIndex={-1} onClick={() => void go()}
        style={{ flex: 1, borderRadius: 22, background: ready ? "var(--gobg)" : "var(--p3)", color: ready ? "var(--ongo)" : "var(--mute)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span className="cond" style={{ fontSize: 150, fontWeight: 800, lineHeight: 0.9 }}>{t("go")}</span>
      </button>
      <button className="b cond" tabIndex={-1} onClick={stopAll} style={{ height: 90, borderRadius: 14, background: "var(--p3)", color: "var(--amb)", fontSize: 26, fontWeight: 800 }}>{t("stopAll")}</button>
      <button className="b cond" tabIndex={-1} onClick={panic} style={{ height: 90, borderRadius: 14, background: "var(--redbg)", border: "2px solid var(--red)", color: "var(--redtx)", fontSize: 26, fontWeight: 800 }}>{t("panic")}</button>
    </>
  );
}
