// The Background screen's left side: deck A and (optionally) deck B, each with a service, its own
// play / pause / next and its own fader, and the crossfade between them. Below: Duck / Restore and the
// overall level for ALL background music. Deck A is violet, deck B teal (lime, red and amber already
// mean GO, stop and warnings). The mixing itself happens in the core (src-tauri/src/background/mixer.rs).

import { useState } from "react";
import { bg, bgDo, SOURCES, useBackground, useEnabledSources, type BgSource, type BgState } from "./useBackground";
import { fmtTime } from "../../lib/format";
import { useT } from "../../i18n";

export const DECK_COLOR = [
  { solid: "var(--deckA)", tint: "var(--deckAbg)" },
  { solid: "var(--deckB)", tint: "var(--deckBbg)" },
] as const;

const FADES = [2, 4, 8];

function loadFade(): number {
  try {
    return Number(localStorage.getItem("sg.xfade")) || 4;
  } catch {
    return 4;
  }
}

export function Decks() {
  const t = useT();
  const st = useBackground();
  const [wantB, setWantB] = useState(false);
  const [fade, setFadeState] = useState(loadFade);
  const setFade = (s: number) => {
    setFadeState(s);
    try {
      localStorage.setItem("sg.xfade", String(s));
    } catch {
      // not remembered
    }
  };
  const decks = st?.decks ?? [null, null];
  const onAir = st?.onAir ?? 0;
  const showB = wantB || !!decks[1];
  const bothSet = !!decks[0] && !!decks[1];
  const other = onAir === 0 ? "B" : "A";

  return (
    <>
      <DeckCard i={0} st={st} />
      {showB ? (
        <>
          {/* The crossfade between the decks */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 12px", borderRadius: 12, background: "var(--p2)", border: "1px dashed var(--line)" }}>
            <button className="b btn btn-go" disabled={!bothSet} onClick={() => bgDo(bg.crossfade(fade))} style={{ height: 44, justifyContent: "center", fontSize: 14 }}>
              ⇅ {st?.lowSpec ? `${t("deck.swapTo")} ${other}` : `${t("deck.crossfadeTo")} ${other} · ${fade} s`}
            </button>
            {!st?.lowSpec && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--dim)" }}>
                <span>{t("deck.fade")}</span>
                {FADES.map((n) => (
                  <button key={n} className="b chip" aria-pressed={fade === n} onClick={() => setFade(n)} style={{ height: 26, fontSize: 12, padding: "0 9px" }}>{n} s</button>
                ))}
                <span style={{ flex: 1 }} />
                <button className="b btn" disabled={!bothSet} onClick={() => bgDo(bg.crossfade(0))} title={t("deck.cutHint")} style={{ height: 26, fontSize: 12 }}>{t("deck.cut")}</button>
              </div>
            )}
            {st?.lowSpec && <span style={{ fontSize: 12, color: "var(--mute)" }}>{t("deck.lowSpecNote")}</span>}
          </div>
          <DeckCard i={1} st={st} />
        </>
      ) : (
        <button className="b" onClick={() => setWantB(true)}
          style={{ height: 44, border: "1px dashed var(--line)", borderRadius: 12, background: "transparent", color: "var(--dim)", fontSize: 13, fontWeight: 700 }}>
          + {t("deck.addSecond")}
        </button>
      )}
      <Overall st={st} />
    </>
  );
}

function DeckCard({ i, st }: { i: 0 | 1; st: BgState | null }) {
  const t = useT();
  const sources = useEnabledSources();
  const src = st?.decks?.[i] ?? null;
  const player = src ? st?.players?.find((p) => p.source === src) : undefined;
  const onAir = (st?.onAir ?? 0) === i;
  const color = DECK_COLOR[i];
  const letter = i === 0 ? "A" : "B";
  const pct = player?.position != null && player.duration ? Math.min(100, (player.position / player.duration) * 100) : 0;

  const choose = (value: string) => {
    const s = (value || null) as BgSource | null;
    // Opening the service makes sure its player exists (and shows it in the middle).
    if (s) bgDo(bg.open(s, false).then(() => bg.setDeck(i, s)));
    else bgDo(bg.setDeck(i, null));
  };
  const cmd = (c: "play" | "pause" | "next" | "prev") => src && bgDo(bg.command(c, false, src));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, borderRadius: 12, background: "var(--p1)", border: "1px solid var(--line)", borderLeft: `6px solid ${color.solid}`, boxShadow: onAir && src ? `0 0 0 2px ${color.solid}` : "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: ".08em", padding: "3px 8px", borderRadius: 6, background: color.solid, color: "var(--ondeck)" }}>DECK {letter}</span>
        {src && (
          <span className="tag" style={{ background: onAir ? "var(--gobg)" : "var(--p3)", color: onAir ? "var(--ongo)" : "var(--dim)" }}>
            {onAir ? t("deck.onAir") : t("deck.cued")}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {src && <button className="b btn btn-ghost" onClick={() => bgDo(bg.open(src, false))} style={{ height: 26, fontSize: 12 }}>{t("deck.show")}</button>}
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--dim)" }}>
        {t("deck.source")}
        <select className="select" value={src ?? ""} onChange={(e) => choose(e.target.value)} aria-label={t("s.deck.sourceOf", { l: letter })} style={{ flex: 1, height: 30 }}>
          <option value="">{t("deck.empty")}</option>
          {sources.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </label>
      {src && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minHeight: 40 }}>
            <span className="clamp1" style={{ fontSize: 17, fontWeight: 800 }}>{player?.title ?? SOURCES.find((s) => s.id === src)?.label}</span>
            <span className="clamp1" style={{ fontSize: 13, color: "var(--dim)" }}>{player?.artist ?? t("deck.pickHint")}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ height: 5, borderRadius: 3, background: "var(--p3)" }}><div style={{ width: `${pct}%`, height: 5, borderRadius: 3, background: color.solid }} /></div>
            <div className="mono" style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--mute)" }}>
              <span>{player?.position != null ? fmtTime(player.position) : "–:––"}</span><span>{player?.duration ? fmtTime(player.duration) : "–:––"}</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button className="b btn" aria-label={t("bgv.prev")} onClick={() => cmd("prev")} style={{ width: 40, height: 40, justifyContent: "center" }}>⏮</button>
            <button className="b btn" aria-label={player?.playing ? t("bg.pause") : t("bg.play")} onClick={() => cmd(player?.playing ? "pause" : "play")}
              style={{ width: 56, height: 40, justifyContent: "center", fontSize: 15, background: player?.playing ? "var(--gobg)" : "var(--p2)", color: player?.playing ? "var(--ongo)" : "var(--text)" }}>
              {player?.playing ? "❚❚" : "▶"}
            </button>
            <button className="b btn" aria-label={t("bgv.next")} onClick={() => cmd("next")} style={{ width: 40, height: 40, justifyContent: "center" }}>⏭</button>
            <span style={{ flex: 1 }} />
            <span className="mono" style={{ fontSize: 12 }}>{(player?.levelDb ?? 0) <= -60 ? t("audac.wOff") : `${(player?.levelDb ?? 0).toFixed(0)} dB`}</span>
          </div>
          {/* The deck's own fader. Low spec mode has one engine for everything: no separate faders. */}
          <input type="range" min={-60} max={0} step={1} value={player?.levelDb ?? 0} disabled={st?.lowSpec}
            title={st?.lowSpec ? t("deck.noFaderLowSpec") : undefined} aria-label={t("s.deck.levelOf", { l: letter })}
            onChange={(e) => bgDo(bg.setFader(src, Number(e.target.value)))} style={{ width: "100%", accentColor: color.solid }} />
        </>
      )}
    </div>
  );
}

/** Duck / Restore and the level for ALL background music (as in Run). */
function Overall({ st }: { st: BgState | null }) {
  const t = useT();
  const tile = (on: boolean) => ({ height: 40, justifyContent: "center", borderRadius: 10, fontWeight: 700, background: on ? "var(--hl)" : "var(--p2)", color: on ? "var(--bg)" : "var(--text)" });
  return (
    <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
      <span className="k">{t("deck.all")}</span>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
        <button className="b btn" onClick={() => bgDo(bg.command("duck"))} style={tile(!!st?.ducked)}>{t("bgv.duck")} · D</button>
        <button className="b btn" onClick={() => bgDo(bg.command("restore"))} style={tile(!st?.ducked)}>{t("bgv.restore")} · R</button>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--dim)" }}>
        {t("bgv.level")}
        <input type="range" min={-40} max={0} step={0.5} value={st?.levelDb ?? 0} aria-label={t("bgv.level")} onChange={(e) => bgDo(bg.setLevel(Number(e.target.value)))} style={{ flex: 1 }} />
        <span className="mono" style={{ width: 52, textAlign: "right", color: "var(--text)" }}>{(st?.levelDb ?? 0).toFixed(1)} dB</span>
      </label>
    </div>
  );
}

/** A service's state for its tab: playing (green ▶), paused (red ❚❚) or loaded (blue ●). */
export function playerStatus(st: BgState | null, source: BgSource): "playing" | "paused" | "loaded" {
  const p = st?.players?.find((x) => x.source === source);
  if (p?.playing) return "playing";
  if (p && (p.held || (p.position ?? 0) > 0)) return "paused";
  return "loaded";
}
