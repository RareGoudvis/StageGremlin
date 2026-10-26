// The Background screen (4th mode): music between and around shows, and the school's zones.
// Left: playback (play/pause, next, duck/restore, level, up next). Middle: the player itself, one
// tab per service. Right: the AUDAC zones, or the main output when there is no AUDAC.
// No cues and no GO here. Switching to Run hands the music to Run's dock; nothing restarts.
//
// The player is the same separate window as always; on this screen it is placed exactly over the
// middle area, without a frame (bg_dock). It steps aside while a dialog or menu needs that space,
// and goes back to a hidden, normal window when you leave this screen.

import { useEffect, useRef } from "react";
import { useUi } from "../uiStore";
import { useMenu } from "../components/ContextMenu";
import { backgroundKey, bg, bgDo, SOURCES, useBackground, type BgSource } from "../components/background/useBackground";
import { AudacPanel } from "../components/audac/AudacPanel";
import { useAudacConfigured } from "../lib/audac";
import { useSettings } from "../settingsStore";
import { StreamboxPanel } from "../components/StreamboxPanel";
import { MasterFader, OutputChip } from "../components/TopBar";
import { MasterMeter } from "../components/MasterMeter";
import { isTauri } from "../lib/tauri";
import { fmtTime } from "../lib/format";
import { useT } from "../i18n";

export function BackgroundView() {
  const t = useT();
  const audacOn = useAudacConfigured();
  const hasBox = useSettings((s) => !!s.ui.streambox.ip);
  useBackgroundKeys();
  const panel = { minHeight: 0, borderRadius: 14, background: "var(--p1)", border: "1px solid var(--line)" } as const;
  return (
    <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "300px minmax(0, 1fr) 380px", gap: 12, padding: "12px 14px" }}>
      <section aria-label={t("bgv.playback")} className="scroll" style={{ ...panel, padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        <Playback />
        <span style={{ marginTop: "auto", paddingTop: 10, borderTop: "1px solid var(--line)", fontSize: 12, color: "var(--mute)", lineHeight: 1.45 }}>{t("bgv.noGo")}</span>
      </section>
      {/* Square bottom corners: the player window laid over this panel is square, and fills it to the bottom. */}
      <section aria-label={t("bgv.player")} style={{ ...panel, borderRadius: "14px 14px 0 0", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <Player />
      </section>
      <section aria-label={audacOn ? "AUDAC" : t("bgv.output")} className="scroll" style={{ ...panel, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <span className="k">{audacOn ? t("bgv.zones") : t("bgv.output")}</span>
        {audacOn ? <AudacPanel big /> : <MainOutput />}
        {hasBox && (
          <>
            <span className="k" style={{ marginTop: 8 }}>{t("set.streambox").toUpperCase()}</span>
            <StreamboxPanel />
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

// ---------------------------------------------------------------- left: playback

function Playback() {
  const t = useT();
  const st = useBackground();
  const source = SOURCES.find((s) => s.id === st?.source)?.label;
  const pct = st?.position != null && st.duration ? Math.min(100, (st.position / st.duration) * 100) : 0;
  const big = { height: 52, borderRadius: 12, justifyContent: "center" } as const;
  const tile = (on: boolean) => ({ height: 44, justifyContent: "center", borderRadius: 10, fontWeight: 700, background: on ? "var(--hl)" : "var(--p2)", color: on ? "var(--bg)" : "var(--text)" });

  return (
    <>
      <span className="k">{t("bgv.nowPlaying")}{source ? ` · ${source}` : ""}</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minHeight: 52 }}>
        <span style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.15 }}>{st?.title ?? t("bgv.nothing")}</span>
        {st?.artist && <span style={{ fontSize: 14, color: "var(--dim)" }}>{st.artist}</span>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ height: 6, borderRadius: 3, background: "var(--p3)" }}><div style={{ width: `${pct}%`, height: 6, borderRadius: 3, background: "var(--acc)" }} /></div>
        <div className="mono" style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--dim)" }}>
          <span>{st?.position != null ? fmtTime(st.position) : "–:––"}</span><span>{st?.duration ? fmtTime(st.duration) : "–:––"}</span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
        <button className="b btn" aria-label={t("bgv.prev")} disabled={!st?.open} onClick={() => bgDo(bg.command("prev"))} style={{ ...big, width: 52 }}>⏮</button>
        <button className="b btn btn-go" aria-label={st?.playing ? t("bg.pause") : t("bg.play")} disabled={!st?.open} onClick={() => bgDo(bg.command(st?.playing ? "pause" : "play"))} style={{ ...big, width: 72, fontSize: 20 }}>
          {st?.playing ? "❚❚" : "▶"}
        </button>
        <button className="b btn" aria-label={t("bgv.next")} disabled={!st?.open} onClick={() => bgDo(bg.command("next"))} style={{ ...big, width: 52 }}>⏭</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
        <button className="b btn" onClick={() => bgDo(bg.command("duck"))} style={tile(!!st?.ducked)}>{t("bgv.duck")} · D</button>
        <button className="b btn" onClick={() => bgDo(bg.command("restore"))} style={tile(!st?.ducked)}>{t("bgv.restore")} · R</button>
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "var(--dim)" }}>
        <span style={{ display: "flex", justifyContent: "space-between" }}>
          <span>{t("bgv.level")}</span><span className="mono" style={{ color: "var(--text)" }}>{(st?.levelDb ?? 0).toFixed(1)} dB</span>
        </span>
        <input type="range" min={-40} max={0} step={0.5} value={st?.levelDb ?? 0} aria-label={t("bgv.level")}
          onChange={(e) => bgDo(bg.setLevel(Number(e.target.value)))} />
      </label>

      {st?.tracks && st.tracks.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
          <span className="k">{t("bgv.upNext")}</span>
          {st.tracks.slice(0, 12).map((tr, i) => (
            <button key={i} className="b" onClick={() => bgDo(bg.playTrack(i, tr.title))}
              style={{ display: "flex", gap: 6, textAlign: "left", padding: "5px 6px", borderRadius: 6, background: "transparent", color: "var(--text)", fontSize: 13 }}>
              <span className="clamp1" style={{ flex: 1 }}>{tr.title}{tr.artist && <span style={{ color: "var(--dim)" }}> · {tr.artist}</span>}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- middle: the player

function Player() {
  const t = useT();
  const st = useBackground();
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
        {SOURCES.map((s) => {
          const on = st?.source === s.id;
          const isOpen = !!st?.openSources?.includes(s.id);
          return (
            <span key={s.id} style={{ display: "flex", alignItems: "center", borderRadius: 8, background: on ? "var(--hl)" : "transparent" }}>
              <button role="tab" aria-selected={on} className="b" onClick={() => pick(s.id)}
                style={{ height: 34, padding: "0 10px 0 12px", borderRadius: 8, fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 6, background: "transparent", color: on ? "var(--bg)" : "var(--text)" }}>
                {/* Dot: this service's window is open (and may be playing). */}
                {isOpen && <span style={{ width: 7, height: 7, borderRadius: 4, background: on ? "var(--bg)" : "var(--acc)" }} />}
                {s.label}
              </button>
              {isOpen && (
                <button className="b" aria-label={`${t("bgv.closeService")} ${s.label}`} title={`${t("bgv.closeService")} ${s.label}`} onClick={() => bgDo(bg.close(s.id))}
                  style={{ height: 34, width: 26, padding: 0, borderRadius: 8, background: "transparent", color: on ? "var(--bg)" : "var(--mute)", fontSize: 14 }}>×</button>
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
