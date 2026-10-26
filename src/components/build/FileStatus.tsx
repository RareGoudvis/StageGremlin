// The file box in the inspector and cue editor: path, loudness, analysis state,
// and "Convert to M4A" for formats the decoder can't play.

import { useState } from "react";
import { useDoc } from "../../store";
import type { Cue } from "../../types";
import { normGain } from "../../types";
import { convertCue } from "../../lib/fileActions";
import { locateCue, reloadCue, replaceCueFile, showInFolder, useMedia } from "../../lib/media";
import { isTauri } from "../../lib/tauri";
import { fmtDb, fmtTime } from "../../lib/format";
import { ToolInstall } from "../ToolInstall";

export function FileStatus({ cue }: { cue: Cue }) {
  const status = useDoc((s) => s.analysis[cue.id]);
  const settings = useDoc((s) => s.show.settings);
  const [needFfmpeg, setNeedFfmpeg] = useState(false);
  const norm = normGain(cue.loudness, settings);
  const missing = useMedia((s) => !!s.missing[cue.id]);
  const bad = status?.state === "error" || missing;
  const unsupported = status?.state === "error" && status.unsupported;

  const convert = async () => {
    const ok = await convertCue(cue.id);
    setNeedFfmpeg(!ok);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 10, borderRadius: 10, background: bad ? "var(--redbg)" : "var(--p2)", border: `1px solid ${bad ? "var(--red)" : "var(--line)"}` }}>
      <span className="mono" style={{ fontSize: 12, wordBreak: "break-all", userSelect: "text" }}>{cue.file || "(no file)"}</span>
      {cue.swappedFrom && (
        <span className="mono" style={{ fontSize: 11.5, color: "var(--ambtx)", wordBreak: "break-all" }}>swapped from {cue.swappedFrom}</span>
      )}
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        {status?.state === "busy" && <span className="tag pulse">ANALYSING…</span>}
        {status?.state === "converting" && <span className="tag pulse">CONVERTING TO M4A…</span>}
        {missing && <span className="tag tag-red">FILE MISSING</span>}
        {unsupported && <span className="tag tag-red">CAN'T PLAY THIS FORMAT</span>}
        {!missing && status?.state === "error" && !unsupported && <span className="tag tag-red" title={status.message}>CAN'T READ FILE</span>}
        {cue.loudness && !bad && (
          <>
            <span className="mono" style={{ fontSize: 12, color: "var(--dim)" }}>
              {cue.loudness.lufs.toFixed(1)} LUFS · peak {cue.loudness.truePeakDb.toFixed(1)} dBTP · {fmtTime(cue.loudness.duration)}
            </span>
            <span className={`tag ${norm.peakLimited ? "tag-amb" : "tag-ok"}`} title={norm.peakLimited ? `Boost capped so the loudest peak stays under ${settings.peakCeilingDb} dBTP` : `Matched to ${settings.targetLufs} LUFS`}>
              {fmtDb(norm.gainDb)}{norm.peakLimited ? " · PEAK-LIMITED" : ""}
            </span>
          </>
        )}
        {!cue.loudness && !status && <span className="tag tag-amb">NOT ANALYSED</span>}
        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {unsupported && (
            <button className="b btn" style={{ height: 26, fontSize: 12, background: "var(--red)", color: "var(--onred)", fontWeight: 700 }} onClick={() => void convert()}>
              Convert to M4A
            </button>
          )}
          {missing && (
            <button className="b btn" style={{ height: 26, fontSize: 12, background: "var(--red)", color: "var(--onred)", fontWeight: 700 }} onClick={() => void locateCue(cue.id)}>Locate…</button>
          )}
        </span>
      </div>
      {/* File actions: reload after editing the file elsewhere, swap in another file (keeps settings), open its folder. */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {!unsupported && !missing && <button className="b btn" style={{ height: 26, fontSize: 12 }} onClick={() => void reloadCue(cue.id)}>Reload from disk</button>}
        <button className="b btn" style={{ height: 26, fontSize: 12 }} onClick={() => void replaceCueFile(cue.id)}>Replace…</button>
        {isTauri && !missing && <button className="b btn" style={{ height: 26, fontSize: 12 }} onClick={() => void showInFolder(cue.id)}>Show in folder</button>}
      </div>
      {missing && <span style={{ fontSize: 12, color: "var(--redtx)" }}>This file isn't on disk any more. Locate it, or pick a replacement. Run stays blocked until it's fixed.</span>}
      {!missing && status?.state === "error" && <span style={{ fontSize: 12, color: "var(--redtx)" }}>{status.message}</span>}
      {needFfmpeg && <ToolInstall what="ffmpeg" why="It's needed to convert this file." />}
    </div>
  );
}
