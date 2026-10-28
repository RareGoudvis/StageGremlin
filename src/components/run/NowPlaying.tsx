// The big card in the middle of Run: what's playing, how long it has left, and its notes.
// When nothing plays it shows the cue standing by instead.

import { useDoc } from "../../store";
import type { Cue, RunningInfo } from "../../types";
import { findCue } from "../../lib/showOps";
import { fmtTime } from "../../lib/format";
import { pauseAll, releaseVamp, stopCue, toggleUnder } from "../../lib/runActions";
import { useEngine } from "../../engineStore";
import { showRunning } from "../../lib/showMath";
import { openMenu } from "../ContextMenu";
import { nowPlayingMenu } from "../../lib/menus";
import { useUi } from "../../uiStore";
import { undoSwap } from "./SwapDialog";
import { useT } from "../../i18n";

const WARN_SECS = 10;

export function NowPlaying({ run, standbyId, onFocus }: {
  run: RunningInfo | null;
  standbyId: string | null;
  onFocus: (instance: number) => void;
}) {
  const show = useDoc((s) => s.show);
  const t = useT();
  const others = showRunning(useEngine((s) => s.state?.running));
  const pending = useEngine((s) => s.state?.pending) ?? [];
  const paused = useEngine((s) => !!s.state?.paused);
  const cue = run ? findCue(show, run.cueId) : findCue(show, standbyId);
  const underDb = cue?.underDb ?? show.settings.underDb;

  const lastPass = run ? run.playCount !== 0 && run.pass >= run.playCount : false;
  const warn = !!run && lastPass && run.remaining < WARN_SECS && !run.vamping;
  const frac = run && run.length > 0 ? run.position / run.length : 0;

  return (
    <section aria-label={t("run.nowPlaying")} onContextMenu={(e) => run && openMenu(e, nowPlayingMenu(run))} style={{ position: "relative",
      flex: "none", borderRadius: 16, background: "var(--p1)", border: `1px solid ${run ? "var(--acc)" : "var(--line)"}`,
      padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10,
    }}>
      {paused && (
        // Across the whole card: impossible to miss in a dark booth.
        <div role="alert" onClick={() => pauseAll()} style={{ position: "absolute", inset: 0, zIndex: 5, borderRadius: 16, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <span className="cond" style={{ padding: "14px 28px", borderRadius: 12, background: "var(--amb)", color: "var(--onamb)", fontSize: 40, fontWeight: 800, letterSpacing: ".06em" }}>
            {t("r.np.paused")}
          </span>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minHeight: 34 }}>
        <span className="k" style={{ color: run ? "var(--acc)" : "var(--mute)" }}>{run ? t("run.nowPlaying") : t("run.silence")}</span>
        {run && (
          <span className="mono" style={{ fontSize: 13, color: "var(--dim)" }}>
            {run.playCount === 0 ? t("r.np.loopPass", { n: run.pass }) : t("r.np.pass", { n: run.pass, of: run.playCount })}
          </span>
        )}
        {run?.under && <span className="tag tag-amb">{t("r.np.under", { db: underDb })}</span>}
        {run?.vamping && <span className="tag tag-cy">{t("r.np.vamping")}</span>}
        {run?.stopping && <span className="tag tag-amb">{t("r.np.stopping")}</span>}
        {cue?.swappedFrom && (
          <span className="tag tag-amb" title={t("r.np.original", { file: cue.swappedFrom })} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            {t("r.np.swappedFile")}
            <button className="b" tabIndex={-1} onClick={() => undoSwap(cue.id)} style={{ background: "transparent", color: "inherit", fontSize: 10.5, fontWeight: 800, textDecoration: "underline", padding: 0 }}>{t("r.np.undo")}</button>
          </span>
        )}
        <span style={{ flex: 1 }} />
        {run && (
          <>
            {run.vamping && (
              <button className="b btn" tabIndex={-1} onClick={() => releaseVamp(run.cueId)} style={{ height: 34, background: "var(--cy)", color: "var(--oncy)", fontWeight: 800 }}>{t("r.np.releaseVamp")}</button>
            )}
            <button className="b btn" tabIndex={-1} onClick={() => toggleUnder(run.cueId)}
              style={{ height: 34, fontWeight: 800, background: run.under ? "var(--amb)" : "var(--p3)", color: run.under ? "var(--onamb)" : "var(--amb)" }}>
              {run.under ? t("r.np.backUp") : t("r.np.underBtn", { db: String(underDb).replace("-", "−") })}
            </button>
            <button className="b btn" tabIndex={-1} onClick={() => stopCue(run.cueId)} style={{ height: 34 }}>{t("r.np.stopThis")}</button>
          </>
        )}

      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 16, minWidth: 0 }}>
        <span className="mono" style={{ fontSize: 34, fontWeight: 600, color: "var(--acc)" }}>{cue?.number ?? "—"}</span>
        <span className="cond clamp1" style={{ fontSize: 42, fontWeight: 800, lineHeight: 1.05, flex: 1 }}>{cue?.name ?? t("run.endOfShow")}</span>
        {cue && (
          <button className="b btn" tabIndex={-1} onClick={() => useUi.getState().openDialog({ kind: "swap", cueId: cue.id })} style={{ height: 30, color: "var(--redtx)", alignSelf: "center" }} title={t("r.swapTitle")}>{t("r.np.swapBtn")}</button>
        )}
      </div>

      {run && (
        <>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 18, flexWrap: "wrap" }}>
            <span className="mono" style={{ fontSize: 64, fontWeight: 600, lineHeight: 0.9, color: warn ? "var(--amb)" : "var(--text)" }}>
              −{fmtTime(run.remaining)}
            </span>
            <span className="mono" style={{ fontSize: 16, color: "var(--dim)", paddingBottom: 4 }}>
              {fmtTime(run.position)} / {fmtTime(run.length)}
            </span>
            {run.nextMarker && (
              <span className="mono" style={{ marginLeft: "auto", padding: "6px 12px", borderRadius: 8, background: "var(--lxbg)", color: "var(--lx)", fontSize: 18, fontWeight: 600 }}>
                {t("r.np.markerIn", { name: run.nextMarker[0], t: fmtTime(run.nextMarker[1]) })}
              </span>
            )}
          </div>
          <div style={{ height: 10, background: "var(--p3)", borderRadius: 5, position: "relative", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.min(100, frac * 100)}%`, borderRadius: 5, background: warn ? "var(--amb)" : "var(--acc)" }} />
            {cue?.markers.map((m, i) => (
              <span key={i} style={{ position: "absolute", top: 0, bottom: 0, width: 3, background: "var(--lx)", left: `${((m.t - cue.trimIn) / run.length) * 100}%` }} />
            ))}
          </div>
        </>
      )}

      {cue && <Notes cue={cue} />}

      {(others.length > 1 || pending.length > 0) && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {others.length > 1 && <span className="k">{t("r.np.alsoPlaying")}</span>}
          {others.length > 1 && others.filter((o) => o.instance !== run?.instance).map((o) => (
            <button key={o.instance} className="b btn" onClick={() => onFocus(o.instance)} style={{ height: 28, fontSize: 12.5 }} title={t("r.np.showInCard")}>
              <span className="mono">{o.number}</span> {o.name} <span className="mono" style={{ color: "var(--dim)" }}>−{fmtTime(o.remaining)}</span>
            </button>
          ))}
          {pending.length > 0 && <span className="k" style={{ marginLeft: others.length > 1 ? 8 : 0 }}>{t("r.np.firesItself")}</span>}
          {pending.map((p, i) => {
            const c = findCue(show, p.cueId);
            return (
              <span key={i} className="mono" style={{ fontSize: 12.5, padding: "4px 8px", borderRadius: 6, background: "var(--p3)", color: "var(--acc)" }}>
                {t(p.kind === "preWait" ? "r.np.preWaitIn" : "r.np.pendingIn", { n: c?.number ?? "", t: fmtTime(p.inSecs) })}
              </span>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Notes({ cue }: { cue: Cue }) {
  const t = useT();
  const items: [string, string, string][] = [
    [t("r.notes.sound"), cue.notes.sound, "var(--ambtx)"],
    [t("r.notes.lx"), cue.notes.lx, "var(--lx)"],
    [t("r.notes.stage"), cue.notes.stage, "var(--st)"],
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
      {items.map(([label, text, color]) => (
        <div key={label} style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span className="k" style={{ color }}>{label}</span>
          <span style={{ fontSize: 15, lineHeight: 1.3, color: text ? color : "var(--mute)", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {text || "—"}
          </span>
        </div>
      ))}
    </div>
  );
}
