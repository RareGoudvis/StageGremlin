// Build → "Background" button and its panel: pick a source, open the full player window to sign in
// and choose a playlist, and set the duck level, fade times, source offsets and auto-duck.
// Settings are stored in the show (show.background, see showSync.ts); the per-machine
// <dataDir>/background.json is what a show without its own settings starts from.

import { useT } from "../../i18n";
import { useEffect, useState } from "react";
import { bg, bgDo, DEFAULT_CONFIG, SOURCES, useBackground, type BgConfig, type BgSource } from "./useBackground";
import { readShowBackground, saveBackgroundToShow } from "./showSync";
import { useDoc } from "../../store";

/** The toolbar button; renders the panel when open. */
export function BackgroundButton() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const st = useBackground();
  // Once a player is open, the button shows what plays and gets a play/pause button next to it:
  // quick control while you're still adjusting things in Build.
  const nowPlaying = st?.open && st.title ? `${st.title}${st.artist ? ` · ${st.artist}` : ""}` : null;
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 2 }}>
      <button
        className="b btn"
        onClick={() => setOpen(true)}
        title={nowPlaying ?? "Background music player"}
        style={{ background: "var(--cybg)", color: "var(--cy)", border: "1px solid var(--cyline)", fontWeight: 700, maxWidth: 260, borderRadius: st?.open ? "8px 0 0 8px" : undefined }}
      >
        <span style={{ width: 8, height: 8, borderRadius: 4, flex: "none", background: st?.playing ? "var(--cy)" : "var(--mute)" }} />
        <span className="clamp1">{nowPlaying ?? t("top.background")}</span>
      </button>
      {st?.open && (
        <button
          className="b btn btn-icon"
          onClick={() => bgDo(bg.command(st.playing ? "pause" : "play"))}
          aria-label={st.playing ? t("bg.pause") : t("bg.play")}
          title={st.playing ? t("bg.pause") : t("bg.play")}
          style={{ width: 36, background: "var(--cybg)", color: "var(--cy)", border: "1px solid var(--cyline)", borderRadius: "0 8px 8px 0" }}
        >
          {st.playing ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5v14l12-7z" /></svg>
          )}
        </button>
      )}
      {open && <BackgroundPanel onClose={() => setOpen(false)} />}
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
            {SOURCES.map((s) => (
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
            {SOURCES.map((s) => (
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
