// YouTube import: paste links, playlist links or "artist – title" lines → check the list →
// download → each finished download becomes a cue (playlists get their own section).
// Shown as the "YouTube & lists" tab of the Add window (AddDialog.tsx).

import { useEffect, useMemo, useState } from "react";
import { useDoc } from "../../store";
import { toast } from "../../uiStore";
import type { Cue } from "../../types";
import { newCue, newSection } from "../../types";
import type { YtFormat, YtItem } from "../../types";
import { call, stripExt, basename } from "../../lib/tauri";
import { analyseCue } from "../../lib/fileActions";
import { insertCues, locate } from "../../lib/showOps";
import { hasTool, useTools } from "../../lib/tools";
import { useYt, ytDownload } from "../../lib/youtube";
import { fmtTime } from "../../lib/format";
import { ToolInstall } from "../ToolInstall";
import { useSettings } from "../../settingsStore";

interface Row extends YtItem { checked: boolean; replace: string; busy?: boolean }

/** Where new cues go: after `afterId`, or at the end of `sectionId`. */
export interface AddTarget { afterId: string | null; sectionId?: string }

export function YoutubePanel({ target }: { target: AddTarget }) {
  const tools = useTools((s) => s.status);
  const progress = useYt((s) => s.progress);
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [format, setFormat] = useState<YtFormat>(() => useSettings.getState().ui.ytFormat);
  const [resolving, setResolving] = useState(false);
  const [downloading, setDownloading] = useState<string[] | null>(null);
  const [added, setAdded] = useState(false);

  useEffect(() => void useTools.getState().refresh(), []);

  const ytOk = hasTool(tools, "ytDlp");
  const needFfmpeg = format !== "original" && !hasTool(tools, "ffmpeg");
  const chosen = rows.filter((r) => r.checked && !r.error);

  const resolve = async () => {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    setResolving(true);
    try {
      const items = await call("yt_resolve", { lines });
      setRows(items.map((i) => ({ ...i, checked: !i.error, replace: "" })));
    } catch (e) {
      toast(`Couldn't look those up: ${e}`);
    } finally {
      setResolving(false);
    }
  };

  /** Paste a different link for one row and look it up again. */
  const reResolve = async (idx: number) => {
    const line = rows[idx].replace.trim();
    if (!line) return;
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, busy: true } : r)));
    try {
      const [item] = await call("yt_resolve", { lines: [line] });
      setRows((rs) => rs.map((r, i) => (i === idx ? { ...item, checked: !item.error, replace: "", playlist: r.playlist } : r)));
    } catch (e) {
      toast(`Couldn't look that up: ${e}`);
      setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, busy: false } : r)));
    }
  };

  const download = async () => {
    if (!chosen.length) return;
    setDownloading(chosen.map((r) => r.id));
    try {
      await ytDownload(chosen, format);
    } catch (e) {
      toast(`Download failed to start: ${e}`);
      setDownloading(null);
    }
  };

  // When every chosen download has finished (done or error), turn the done ones into cues once.
  const states = downloading?.map((id) => progress[id]?.status) ?? [];
  const finished = !!downloading && states.every((s) => s === "done" || s === "error");
  useEffect(() => {
    if (!finished || added || !downloading) return;
    setAdded(true);
    addCues(rows.filter((r) => downloading.includes(r.id)), progress, target);
  }, [finished, added, downloading, rows, progress, target]);

  const total = useMemo(() => chosen.reduce((a, r) => a + r.duration, 0), [chosen]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <span style={{ fontSize: 12.5, color: "var(--mute)" }}>
        YouTube's terms of service don't allow downloading videos; whether you do it for your school show is your call.
      </span>
      <ToolInstall what="ytDlp" why="It does the downloading." />

      {!downloading && (
        <>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="k">One per line: a video link, a playlist link, or “artist – title”</span>
            <textarea className="textarea mono" rows={5} value={text} onChange={(e) => setText(e.target.value)}
              placeholder={"https://www.youtube.com/watch?v=…\nhttps://www.youtube.com/playlist?list=…\nK3 – Oya lele"} style={{ fontSize: 13 }} />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="b btn btn-go" disabled={!ytOk || resolving || !text.trim()} onClick={() => void resolve()}>
              {resolving ? "Looking up…" : rows.length ? "Look up again" : "Look up"}
            </button>
          </div>
        </>
      )}

      {rows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "34px minmax(0, 2fr) minmax(0, 1fr) 60px minmax(0, 1.6fr)", gap: 10, padding: "8px 12px", background: "var(--p2)" }} className="k">
            <span /> <span>Title</span> <span>Channel</span> <span>Length</span> <span>{downloading ? "Progress" : "Wrong one? Paste another link"}</span>
          </div>
          {rows.map((r, i) => {
            const p = progress[r.id];
            const showPlaylist = r.playlist && r.playlist !== rows[i - 1]?.playlist;
            return (
              <div key={r.id}>
                {showPlaylist && <div className="cond" style={{ padding: "8px 12px 2px", fontSize: 12, fontWeight: 800, letterSpacing: ".1em", color: "var(--acc)", textTransform: "uppercase" }}>Playlist · {r.playlist}</div>}
                <div style={{ display: "grid", gridTemplateColumns: "34px minmax(0, 2fr) minmax(0, 1fr) 60px minmax(0, 1.6fr)", gap: 10, padding: "6px 12px", alignItems: "center", borderTop: "1px solid var(--line)", opacity: r.error ? 0.7 : 1 }}>
                  <input type="checkbox" aria-label={`Include ${r.title}`} checked={r.checked} disabled={!!r.error || !!downloading}
                    onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, checked: e.target.checked } : x)))} />
                  <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <span className="clamp1" style={{ fontSize: 14, fontWeight: 600 }}>{r.title || r.input}</span>
                    {r.error ? <span style={{ fontSize: 12, color: "var(--redtx)" }}>{r.error}</span> : <span className="mono clamp1" style={{ fontSize: 11, color: "var(--mute)" }}>{r.input}</span>}
                  </span>
                  <span className="clamp1" style={{ fontSize: 13, color: "var(--dim)" }}>{r.channel}</span>
                  <span className="mono" style={{ fontSize: 12.5 }}>{fmtTime(r.duration)}</span>
                  {downloading ? (
                    downloading.includes(r.id) ? <ProgressCell status={p?.status ?? "queued"} percent={p?.percent ?? 0} error={p?.error ?? null} /> : <span className="mute" style={{ fontSize: 12 }}>skipped</span>
                  ) : (
                    <span style={{ display: "flex", gap: 6 }}>
                      <input className="input mono" aria-label="Replacement link" placeholder="link or artist – title" value={r.replace} style={{ flex: 1, height: 28, fontSize: 12 }}
                        onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, replace: e.target.value } : x)))}
                        onKeyDown={(e) => e.key === "Enter" && void reResolve(i)} />
                      <button className="b btn" style={{ height: 28, fontSize: 12 }} disabled={!r.replace.trim() || r.busy} onClick={() => void reResolve(i)}>{r.busy ? "…" : "Replace"}</button>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {rows.length > 0 && !downloading && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span className="k">Format</span>
            <select className="select" aria-label="Format" value={format} onChange={(e) => setFormat(e.target.value as YtFormat)} style={{ width: 260 }}>
              <option value="original">Original (m4a) — best quality, fastest</option>
              <option value="mp3">MP3 (needs ffmpeg)</option>
              <option value="wav">WAV (needs ffmpeg, large files)</option>
            </select>
            <span style={{ flex: 1 }} />
            <span className="mono" style={{ fontSize: 12.5, color: "var(--dim)" }}>{chosen.length} chosen · {fmtTime(total)}</span>
            <button className="b btn btn-go" style={{ height: 38 }} disabled={!chosen.length || needFfmpeg} onClick={() => void download()}>
              Download {chosen.length} and add as cues
            </button>
          </div>
          {needFfmpeg && <ToolInstall what="ffmpeg" why="MP3 and WAV need it; Original doesn't." />}
        </>
      )}
      {finished && <span style={{ fontSize: 14, color: "var(--acc)", fontWeight: 600 }}>Done. The downloads are in the show as new cues and are being analysed.</span>}
    </div>
  );
}

function ProgressCell({ status, percent, error }: { status: string; percent: number; error: string | null }) {
  if (status === "error") return <span style={{ fontSize: 12, color: "var(--redtx)" }}>{error ?? "failed"}</span>;
  const label = status === "done" ? "done" : status === "converting" ? "converting…" : status === "queued" ? "waiting…" : `${Math.round(percent)}%`;
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--p3)", overflow: "hidden" }}>
        <span style={{ display: "block", height: "100%", width: `${status === "done" ? 100 : percent}%`, background: status === "done" ? "var(--acc)" : "var(--st)" }} />
      </span>
      <span className="mono" style={{ fontSize: 11.5, width: 76, color: status === "done" ? "var(--acc)" : "var(--dim)" }}>{label}</span>
    </span>
  );
}

/**
 * Finished downloads → cues, in one undo step. Items from a playlist go into a new
 * section named after it; single videos land after the selected cue.
 */
function addCues(rows: Row[], progress: Record<string, { status: string; file: string | null }>, target: AddTarget) {
  const done = rows.filter((r) => progress[r.id]?.status === "done" && progress[r.id]?.file);
  if (!done.length) return;
  const mk = (r: Row): Cue => newCue({ name: r.title || stripExt(basename(progress[r.id].file!)), file: progress[r.id].file! });
  const singles = done.filter((r) => !r.playlist).map(mk);
  const lists = new Map<string, Cue[]>();
  for (const r of done.filter((r) => r.playlist)) lists.set(r.playlist!, [...(lists.get(r.playlist!) ?? []), mk(r)]);

  const doc = useDoc.getState();
  const after = target.afterId;
  doc.edit((s) => {
    let show = singles.length ? insertCues(s, singles, after && locate(s, after) ? after : null, target.sectionId) : s;
    for (const [name, cues] of lists) {
      // New section right after the target's section (or at the end).
      const sec = { ...newSection(name), cues };
      const at = after ? show.sections.findIndex((x) => x.cues.some((c) => c.id === after)) : show.sections.findIndex((x) => x.id === target.sectionId);
      const i = at >= 0 ? at + 1 : show.sections.length;
      show = { ...show, sections: [...show.sections.slice(0, i), sec, ...show.sections.slice(i)] };
    }
    return show;
  });
  const all = [...singles, ...[...lists.values()].flat()];
  doc.setSelection(all.map((c) => c.id));
  for (const c of all) void analyseCue(c.id);
}
