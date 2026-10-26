// Top-bar background pill, and the background settings panel: pick a source, open the full player window to sign in
// and choose a playlist, and set the duck level, fade times, source offsets and auto-duck.
// Settings are stored in the show (show.background, see showSync.ts); the per-machine
// <dataDir>/background.json is what a show without its own settings starts from.

import { useT } from "../../i18n";
import { useEffect, useState } from "react";
import { requestModeByClick } from "../../lib/modeSwitch";
import { bg, bgDo, DEFAULT_CONFIG, SOURCES, useBackground, useEnabledSources, type BgConfig, type BgSource } from "./useBackground";
import { readShowBackground, saveBackgroundToShow } from "./showSync";
import { useDoc } from "../../store";

/** The top-bar pill in Build / Preflight: what the background music is doing, with play/pause.
 *  Only there once a player is open: otherwise the "4 Background" tab already says it all.
 *  Clicking it goes to the Background screen (its settings live in Settings › Background music). */
export function BackgroundButton() {
  const t = useT();
  const st = useBackground();
  if (!st?.open) return null;
  // The on-air deck when decks are in use, else the active player (as before the decks).
  const onAirSrc = st.decks?.[st.onAir ?? 0] ?? st.source;
  const p = st.players?.find((x) => x.source === onAirSrc);
  const title = p?.title ?? st.title;
  const artist = p?.artist ?? st.artist;
  const playing = p ? p.playing : st.playing;
  const label = title ? `${title}${artist ? ` · ${artist}` : ""}` : SOURCES.find((s) => s.id === onAirSrc)?.label ?? t("top.background");
  const cmd = () => bgDo(p ? bg.command(playing ? "pause" : "play", false, p.source) : bg.command(playing ? "pause" : "play"));
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 2 }}>
      <button
        className="b btn"
        onClick={() => requestModeByClick("background")}
        title={`${label} · ${t("mode.background")}`}
        style={{ background: "var(--cybg)", color: "var(--cy)", border: "1px solid var(--cyline)", fontWeight: 700, maxWidth: 260, borderRadius: "8px 0 0 8px" }}
      >
        <span style={{ width: 8, height: 8, borderRadius: 4, flex: "none", background: playing ? "var(--cy)" : "var(--mute)" }} />
        {/* The note stays when the title folds away (narrow window); the title is in the tooltip. */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true" style={{ flex: "none" }}>
          <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
        </svg>
        <span className="clamp1 tb-bg-label">{label}</span>
      </button>
      <button
        className="b btn btn-icon"
        onClick={cmd}
        aria-label={playing ? t("bg.pause") : t("bg.play")}
        title={playing ? t("bg.pause") : t("bg.play")}
        style={{ width: 36, background: "var(--cybg)", color: "var(--cy)", border: "1px solid var(--cyline)", borderRadius: "0 8px 8px 0" }}
      >
        {playing ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5v14l12-7z" /></svg>
        )}
      </button>
    </span>
  );
}

export function BackgroundPanel({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="scrim" style={{ position: "fixed" }} onClick={onClose}>
      <div className="dialog" role="dialog" aria-label="Background music" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560, borderColor: "var(--cyline)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18, fontWeight: 800, flex: 1 }}>Background music</span>
          <button className="b btn btn-ghost" onClick={onClose}>Close · Esc</button>
        </div>
        <BackgroundSettings />
      </div>
    </div>
  );
}

/** The settings themselves, without the dialog around them (also shown in Settings › Background). */
export function BackgroundSettings() {
  const st = useBackground();
  const sources = useEnabledSources();
  const [config, setConfig] = useState<BgConfig | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // The show's own settings win; otherwise whatever the core has (the machine default).
    const fromShow = readShowBackground(useDoc.getState().show.background);
    if (fromShow) setConfig(fromShow.config);
    else bg.getConfig().then(setConfig).catch(() => setConfig(DEFAULT_CONFIG));
  }, []);

  const save = (c: BgConfig) => {
    setConfig(c);
    saveBackgroundToShow({ config: c });
    bgDo(bg.setConfig(c), setErr);
  };
  const openSource = (s: BgSource) => {
    saveBackgroundToShow({ config: config ?? DEFAULT_CONFIG, source: s });
    bgDo(bg.open(s, true), setErr);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="k">Source · opens the player window to sign in and pick a playlist</span>
          <div className="chips">
            {sources.map((s) => (
              <button key={s.id} className="b chip" aria-pressed={st?.source === s.id} onClick={() => openSource(s.id)}>
                {s.label}
              </button>
            ))}
          </div>
          {st?.open && (
            <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
              <span className="clamp1" style={{ flex: 1, color: "var(--dim)" }}>
                {st.title ? `${st.title}${st.artist ? " · " + st.artist : ""}` : "Nothing playing yet"}
              </span>
              {st.visible
                ? <button className="b btn" onClick={() => bgDo(bg.hide(), setErr)}>Hide window</button>
                : st.source && <button className="b btn" onClick={() => openSource(st.source!)}>Show window</button>}
            </div>
          )}
          {st?.open && !st.sessionFound && (
            <span style={{ fontSize: 12.5, padding: "6px 8px", borderRadius: 6, background: "var(--ambbg)", color: "var(--ambtx)" }}>
              Windows volume control not found yet. Start a song in the player; if this stays, Duck and fades won't work.
            </span>
          )}
          {(st?.error ?? err) && (
            <span style={{ fontSize: 12.5, padding: "6px 8px", borderRadius: 6, background: "var(--redbg)", color: "var(--redtx)" }}>{st?.error ?? err}</span>
          )}
        </section>

        {config && (
          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span className="k">Ducking</span>
            <Num label="Duck level" unit="dB" value={config.duckDb} min={-60} max={0} step={1} onChange={(v) => save({ ...config, duckDb: v })} />
            <Num label="Duck time" unit="s" value={config.duckTime} min={0} max={10} step={0.1} onChange={(v) => save({ ...config, duckTime: v })} />
            <Num label="Restore time" unit="s" value={config.restoreTime} min={0} max={15} step={0.1} onChange={(v) => save({ ...config, restoreTime: v })} />
            <Num label="Restore hold" unit="s" value={config.restoreHold} min={0} max={10} step={0.5} onChange={(v) => save({ ...config, restoreHold: v })} />
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5 }}>
              <input type="checkbox" checked={config.autoDuck} onChange={(e) => save({ ...config, autoDuck: e.target.checked })} />
              Auto-duck: cues with "Duck background" duck the music while they play
            </label>

            <span className="k">Level offset per source</span>
            {sources.map((s) => (
              <Num key={s.id} label={s.label} unit="dB" value={config.offsets[s.id]} min={-24} max={0} step={0.5}
                onChange={(v) => save({ ...config, offsets: { ...config.offsets, [s.id]: v } })} />
            ))}
          </section>
        )}
    </div>
  );
}

function Num({ label, unit, value, min, max, step, onChange }: {
  label: string; unit: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13.5 }}>
      <span style={{ width: 120 }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ flex: 1 }} />
      <span className="mono" style={{ width: 64, textAlign: "right" }}>{value.toFixed(step < 1 ? 1 : 0)} {unit}</span>
    </label>
  );
}
