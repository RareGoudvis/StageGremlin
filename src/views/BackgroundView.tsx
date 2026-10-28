// The Background screen (4th mode): music between and around shows, and the school's zones.
// Left: playback (play/pause, next, duck/restore, level, up next). Middle: the player itself, one
// tab per service. Right: the AUDAC zones, or the main output when there is no AUDAC.
// No cues and no GO here. Switching to Run hands the music to Run's dock; nothing restarts.
//
// The player is the same separate window as always; on this screen it is placed exactly over the
// middle area, without a frame (bg_dock). It steps aside while a dialog or menu needs that space,
// and goes back to a hidden, normal window when you leave this screen.

import { useEffect, useRef, useState } from "react";
import { useUi } from "../uiStore";
import { useMenu } from "../components/ContextMenu";
import { backgroundKey, bg, bgDo, useBackground, useEnabledSources, type BgSource } from "../components/background/useBackground";
import { AudacPanel } from "../components/audac/AudacPanel";
import { useAudacConfigured } from "../lib/audac";
import { useSettings } from "../settingsStore";
import { StreamboxPanel } from "../components/StreamboxPanel";
import { MasterFader, OutputChip } from "../components/TopBar";
import { MasterMeter } from "../components/MasterMeter";
import { Decks, DECK_COLOR, playerStatus } from "../components/background/Decks";
import { isTauri } from "../lib/tauri";
import { useT } from "../i18n";

export function BackgroundView() {
  const t = useT();
  const audacOn = useAudacConfigured();
  const hasBox = useSettings((s) => !!s.ui.streambox.ip);
  useBackgroundKeys();
  const panel = { minHeight: 0, borderRadius: 14, background: "var(--p1)", border: "1px solid var(--line)" } as const;
  // The left panel (decks, duck, level) folds into a thin strip; the player grows into the space
  // (it follows its area by itself). Remembered per laptop, best effort.
  const [folded, setFolded] = useState(() => {
    try { return localStorage.getItem("sg.bgFolded") === "1"; } catch { return false; }
  });
  const fold = (on: boolean) => {
    setFolded(on);
    try { localStorage.setItem("sg.bgFolded", on ? "1" : "0"); } catch { /* not remembered */ }
  };
  const [boxFolded, setBoxFolded] = useState(() => {
    try { return localStorage.getItem("sg.boxFolded") === "1"; } catch { return false; }
  });
  const foldBox = (on: boolean) => {
    setBoxFolded(on);
    try { localStorage.setItem("sg.boxFolded", on ? "1" : "0"); } catch { /* not remembered */ }
  };
  return (
    <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: `${folded ? "52px" : "300px"} minmax(0, 1fr) 380px`, gap: 12, padding: "12px 14px" }}>
      {folded ? (
        <section aria-label={t("bgv.playback")} style={{ ...panel, padding: "8px 6px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <button className="b btn" aria-label={t("bgv.unfold")} title={t("bgv.unfold")} onClick={() => fold(false)} style={{ width: 38, height: 34, justifyContent: "center", padding: 0, fontSize: 16 }}>›</button>
          <button className="b btn" title={`${t("bgv.duck")} · D`} aria-label={t("bgv.duck")} onClick={() => bgDo(bg.command("duck"))} style={{ width: 38, height: 34, justifyContent: "center", padding: 0, fontWeight: 800 }}>D</button>
          <button className="b btn" title={`${t("bgv.restore")} · R`} aria-label={t("bgv.restore")} onClick={() => bgDo(bg.command("restore"))} style={{ width: 38, height: 34, justifyContent: "center", padding: 0, fontWeight: 800 }}>R</button>
        </section>
      ) : (
        <section aria-label={t("bgv.playback")} className="scroll" style={{ ...panel, padding: 16, display: "flex", flexDirection: "column", gap: 14, position: "relative" }}>
          <button className="b btn btn-ghost" aria-label={t("bgv.fold")} title={t("bgv.fold")} onClick={() => fold(true)}
            style={{ position: "absolute", top: 6, right: 6, width: 30, height: 28, justifyContent: "center", padding: 0, fontSize: 16, zIndex: 1 }}>‹</button>
          <Decks />
          <span style={{ marginTop: "auto", paddingTop: 10, borderTop: "1px solid var(--line)", fontSize: 12, color: "var(--mute)", lineHeight: 1.45 }}>{t("bgv.noGo")}</span>
        </section>
      )}
      {/* Square bottom corners: the player window laid over this panel is square, and fills it to the bottom. */}
      <section aria-label={t("bgv.player")} style={{ ...panel, borderRadius: "14px 14px 0 0", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <Player />
      </section>
      <section aria-label={audacOn ? "AUDAC" : t("bgv.output")} className="scroll" style={{ ...panel, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <span className="k">{audacOn ? t("bgv.zones") : t("bgv.output")}</span>
        {audacOn ? <AudacPanel big /> : <MainOutput />}
        {hasBox && (
          <>
            {/* Folds away so the zones get the room; remembered per laptop. */}
            <button className="b k" aria-expanded={!boxFolded} title={boxFolded ? t("bgv.boxShow") : t("bgv.boxHide")} onClick={() => foldBox(!boxFolded)}
              style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6, background: "none", border: 0, padding: 0, cursor: "pointer", textAlign: "left" }}>
              <span style={{ display: "inline-block", width: 12, fontSize: 12 }}>{boxFolded ? "▸" : "▾"}</span>
              {t("set.streambox").toUpperCase()}
            </button>
            {!boxFolded && <StreamboxPanel />}
          </>
        )}
      </section>
    </div>
  );
}

/** The same background keys as in Run (D duck · R restore · Shift+D play/pause · Shift+→ next), not in text fields or dialogs. */
function useBackgroundKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      if ((e.target as HTMLElement).closest("input, textarea, select") || ui.dialog || ui.confirm || useMenu.getState().menu) return;
      if (backgroundKey(e)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

// ---------------------------------------------------------------- middle: the player

function Player() {
  const t = useT();
  const st = useBackground();
  const sources = useEnabledSources();
  const area = useRef<HTMLDivElement>(null);
  // Anything that draws over the middle area (dialogs, menus, the cue editor) makes the player step aside:
  // it is a real window and would otherwise cover them.
  // (Two separate hooks: React needs every hook called on every render.)
  const dialogOpen = useUi((s) => !!(s.dialog || s.confirm || s.editorCueId));
  const menuOpen = useMenu((s) => !!s.menu);
  const covered = dialogOpen || menuOpen;
  const show = !!st?.open && !covered;

  useEffect(() => {
    if (!show) {
      bgDo(bg.dock(null));
      return;
    }
    const el = area.current;
    if (!el) return;
    let frame = 0;
    // Physical pixels inside the main window, recomputed whenever the area or the window moves.
    const place = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const k = window.devicePixelRatio || 1;
        // Round inward (start up, end down) so the player never pokes past the area's edge by a pixel.
        const x = Math.ceil(r.left * k), y = Math.ceil(r.top * k);
        bgDo(bg.dock({ x, y, w: Math.floor(r.right * k) - x, h: Math.floor(r.bottom * k) - y }));
      });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    window.addEventListener("resize", place);
    let unlistenMove: (() => void) | undefined;
    if (isTauri) {
      void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
        getCurrentWindow().onMoved(place).then((un) => (unlistenMove = un)),
      );
    }
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener("resize", place);
      unlistenMove?.();
    };
    // Re-place when another service becomes active: its own window takes the area.
  }, [show, st?.source]);

  // Leaving this screen: the player becomes a normal, hidden window again (Run's dock takes over).
  useEffect(() => () => bgDo(bg.dock(null)), []);

  const pick = (source: BgSource) => bgDo(bg.open(source, false));
  return (
    <>
      <div role="tablist" aria-label={t("bgv.services")} style={{ display: "flex", gap: 4, padding: 6, borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
        {sources.map((s) => {
          const on = st?.source === s.id;
          const isOpen = !!st?.openSources?.includes(s.id);
          // On a deck: filled in the deck's colour (solid while looked at, tinted otherwise).
          const deck = st?.decks ? st.decks.indexOf(s.id) : -1;
          const color = deck >= 0 ? DECK_COLOR[deck] : null;
          const fill = color ? (on ? color.solid : color.tint) : on ? "var(--hl)" : "transparent";
          const text = (color && on) ? "var(--ondeck)" : on ? "var(--bg)" : "var(--text)";
          const status = playerStatus(st, s.id);
          return (
            <span key={s.id} style={{ display: "flex", alignItems: "center", borderRadius: 8, background: fill, border: `2px solid ${color ? color.solid : "transparent"}` }}>
              <button role="tab" aria-selected={on} className="b" onClick={() => pick(s.id)}
                style={{ height: 32, padding: "0 8px 0 10px", borderRadius: 8, fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 6, background: "transparent", color: text }}>
                {/* Green ▶ playing · red ❚❚ paused · blue ● loaded but not playing. */}
                {isOpen && (
                  <span title={t(`deck.st.${status}`)} style={{ fontSize: 11, fontWeight: 900, color: on ? text : `var(--st-${status === "playing" ? "play" : status === "paused" ? "pause" : "idle"})` }}>
                    {status === "playing" ? "▶" : status === "paused" ? "❚❚" : "●"}
                  </span>
                )}
                {s.label}
              </button>
              {isOpen && (
                <button className="b" aria-label={`${t("bgv.closeService")} ${s.label}`} title={`${t("bgv.closeService")} ${s.label}`} onClick={() => bgDo(bg.close(s.id))}
                  style={{ height: 32, width: 24, padding: 0, borderRadius: 8, background: "transparent", color: text, fontSize: 14 }}>×</button>
              )}
            </span>
          );
        })}
        <span style={{ flex: 1 }} />
        {st?.open && (
          <button className="b btn btn-ghost" onClick={() => { bgDo(bg.dock(null)); if (st.source) bgDo(bg.open(st.source, true)); }} style={{ height: 34, fontSize: 12.5 }}>
            {t("bgv.ownWindow")} ↗
          </button>
        )}
      </div>
      {/* The player window is placed exactly over this box. */}
      <div ref={area} style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--p2)", color: "var(--dim)", fontSize: 14, padding: 20, textAlign: "center" }}>
        {!st?.open ? t("bgv.pickService") : covered ? t("bgv.stepAside") : !isTauri ? t("bgv.browser") : ""}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- right without AUDAC: the main output

function MainOutput() {
  const t = useT();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: 12, borderRadius: 10, background: "var(--p2)" }}>
      <OutputChip />
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <MasterMeter />
        <MasterFader />
      </div>
      <span style={{ fontSize: 12.5, color: "var(--dim)" }}>{t("bgv.noAudac")}</span>
    </div>
  );
}
