// Emergency swap (Run): replace the audio of one cue during the show.
// Name, notes, fades, effects and timing stay; loudness matching levels the new file automatically.
// The old file is kept in `swappedFrom`, so "Undo swap" can put it back.

import { useState } from "react";
import { useDoc } from "../../store";
import { toast, useUi } from "../../uiStore";
import type { Cue, Loudness } from "../../types";
import { normGain } from "../../types";
import { findAnyCue, updateAnyCue } from "../../lib/showOps";
import { analyseCue } from "../../lib/fileActions";
import { basename, call, dirname, isTauri, needsConversion, pickAudioFiles } from "../../lib/tauri";
import { previewPlay, previewStop, usePreview, usePreviewInHall } from "../../lib/preview";
import { ytFetchOne } from "../../lib/youtube";
import { hasTool, useTools } from "../../lib/tools";
import { fmtDb, fmtTime } from "../../lib/format";
import { ToolInstall } from "../ToolInstall";

interface Candidate { file: string; title: string; loudness: Loudness }

export function SwapDialog({ cueId }: { cueId: string }) {
  const cue = useDoc((s) => findAnyCue(s.show, cueId));
  const settings = useDoc((s) => s.show.settings);
  const close = useUi((s) => s.closeDialog);
  const tools = useTools((s) => s.status);
  const previewing = usePreview((s) => !!s.state?.playing && s.cueId === `swap:${cueId}`);
  const inHall = usePreviewInHall();
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [cand, setCand] = useState<Candidate | null>(null);

  if (!cue) return null;

  /** Check the file can be decoded and measure it, before it goes anywhere near the show. */
  const take = async (file: string, title: string) => {
    if (needsConversion(file)) {
      toast("That format (opus/webm) can't play. Pick an mp3, m4a or wav.");
      return;
    }
    setBusy("Measuring loudness…");
    try {
      const a = await call("analyze_file", { baseDir: dirname(useDoc.getState().path), file });
      setCand({ file, title, loudness: a.loudness });
    } catch (e) {
      toast(`Can't use that file: ${e}`);
    } finally {
      setBusy(null);
    }
  };

  const pickFile = async () => {
    if (!isTauri) return void take("C:/Schoolfeest/reserve/applaus-alt.m4a", "applaus-alt.m4a");
    const [file] = await pickAudioFiles();
    if (file) await take(file, basename(file));
  };

  const fetchLink = async () => {
    setBusy("Downloading from YouTube…");
    try {
      const { file, item } = await ytFetchOne(link.trim());
      setBusy(null);
      await take(file, item.title);
    } catch (e) {
      toast(`${e}`);
      setBusy(null);
    }
  };

  // The candidate as it would play: this cue's settings with the new file.
  const swapped = (c: Cue, k: Candidate): Partial<Cue> => {
    const d = k.loudness.duration;
    return {
      file: k.file,
      loudness: k.loudness,
      swappedFrom: c.swappedFrom ?? c.file,
      // Keep the trim if it still fits the new file, otherwise play the whole thing.
      trimIn: c.trimIn < d ? c.trimIn : 0,
      trimOut: c.trimOut !== null && c.trimOut <= d ? c.trimOut : null,
    };
  };

  const preview = () => {
    if (!cand) return;
    if (previewing) return void previewStop();
    void previewPlay({ ...cue, ...swapped(cue, cand), id: `swap:${cueId}` }, 0);
  };

  const confirm = () => {
    if (!cand) return;
    void previewStop();
    useDoc.getState().edit((s) => updateAnyCue(s, cueId, swapped(cue, cand)), { allowInRun: true });
    void analyseCue(cueId); // fetches the waveform for the new file
    toast(`${cue.number} ${cue.name} now plays ${cand.title}`);
    close();
  };

  const norm = cand ? normGain(cand.loudness, settings) : null;

  return (
    <div className="scrim" style={{ padding: "70px 24px", zIndex: 66 }}>
      <div role="dialog" aria-label="Emergency swap" className="dialog" style={{ maxWidth: 680, borderColor: "var(--red)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="k" style={{ color: "var(--redtx)" }}>Emergency swap</span>
          <span style={{ flex: 1 }} />
          <button className="b btn" onClick={() => { void previewStop(); close(); }}>Cancel</button>
        </div>
        <span className="cond" style={{ fontSize: 26, fontWeight: 800 }}><span className="mono" style={{ color: "var(--acc)" }}>{cue.number}</span> {cue.name}</span>
        <span style={{ fontSize: 13, color: "var(--dim)" }}>
          Replace this cue's audio. Name, notes, fades, effects and timing stay; the new file is level-matched to {settings.targetLufs} LUFS. Check it in the headphones first.
        </span>
        <span className="mono" style={{ fontSize: 12, color: "var(--mute)" }}>now: {basename(cue.file)}</span>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
          <div style={{ padding: 12, borderRadius: 10, background: "var(--p1)", border: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 8 }}>
            <span className="k">From disk</span>
            <button className="b btn" style={{ height: 38, justifyContent: "center" }} disabled={!!busy} onClick={() => void pickFile()}>Choose a file…</button>
          </div>
          <div style={{ padding: 12, borderRadius: 10, background: "var(--p1)", border: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 8 }}>
            <span className="k">From YouTube</span>
            <input className="input" value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a link or type artist – title" aria-label="YouTube link" style={{ height: 38 }} />
            <button className="b btn" style={{ height: 34, justifyContent: "center" }} disabled={!link.trim() || !!busy || !hasTool(tools, "ytDlp")} onClick={() => void fetchLink()}>Fetch</button>
          </div>
        </div>
        <ToolInstall what="ytDlp" why="Needed for YouTube links." />
        {busy && <span className="pulse" style={{ fontSize: 14, color: "var(--st)" }}>{busy}</span>}

        {cand && norm && (
          <div style={{ padding: 12, borderRadius: 10, background: "var(--p2)", display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>{cand.title}</span>
            <span className="mono" style={{ fontSize: 12, color: "var(--dim)" }}>
              {fmtTime(cand.loudness.duration)} · {cand.loudness.lufs.toFixed(1)} LUFS → plays at {fmtDb(norm.gainDb)}{norm.peakLimited ? " (peak-limited)" : ""}
            </span>
          </div>
        )}
        {inHall && cand && <span className="tag tag-red" style={{ alignSelf: "flex-start" }}>PREVIEW WOULD PLAY IN THE HALL</span>}
        <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: 8 }}>
          <button className="b btn" disabled={!cand} onClick={preview}
            style={{ height: 56, padding: "0 16px", background: previewing ? "var(--st)" : "var(--stbg)", border: "1px solid var(--st)", color: previewing ? "var(--bg)" : "var(--st)", fontWeight: 800 }}>
            {previewing ? "Stop preview" : "Preview first"}
          </button>
          <button className="b btn cond" disabled={!cand} onClick={confirm}
            style={{ height: 56, justifyContent: "center", background: "var(--red)", color: "var(--onred)", fontSize: 20, fontWeight: 800, letterSpacing: ".04em" }}>
            SWAP {cue.number} NOW
          </button>
        </div>
      </div>
    </div>
  );
}

/** Put the original file back (the swap is undone without needing Build's undo). */
export function undoSwap(cueId: string) {
  const cue = findAnyCue(useDoc.getState().show, cueId);
  if (!cue?.swappedFrom) return;
  useDoc.getState().edit((s) => updateAnyCue(s, cueId, { file: cue.swappedFrom!, swappedFrom: null, loudness: null }), { allowInRun: true });
  void analyseCue(cueId);
  toast(`${cue.number} is back to ${basename(cue.swappedFrom)}`);
}
