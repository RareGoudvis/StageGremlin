// The file box in the inspector and cue editor: path, loudness, analysis state,
// and "Convert to M4A" for formats the decoder can't play.

import { useState } from "react";
import { useDoc } from "../../store";
import type { Cue } from "../../types";
import { normGain } from "../../types";
import { analyseCue, convertCue } from "../../lib/fileActions";
import { fmtDb, fmtTime } from "../../lib/format";
import { ToolInstall } from "../ToolInstall";

export function FileStatus({ cue }: { cue: Cue }) {
  const status = useDoc((s) => s.analysis[cue.id]);
  const settings = useDoc((s) => s.show.settings);
  const [needFfmpeg, setNeedFfmpeg] = useState(false);
  const norm = normGain(cue.loudness, settings);
  const bad = status?.state === "error";
  const unsupported = bad && status.unsupported;

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
        {unsupported && <span className="tag tag-red">CAN'T PLAY THIS FORMAT</span>}
        {bad && !unsupported && <span className="tag tag-red" title={status.message}>CAN'T READ FILE</span>}
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
          {!unsupported && <button className="b btn" style={{ height: 26, fontSize: 12 }} onClick={() => void analyseCue(cue.id)}>Re-analyse</button>}
        </span>
      </div>
      {bad && <span style={{ fontSize: 12, color: "var(--redtx)" }}>{status.message}</span>}
      {needFfmpeg && <ToolInstall what="ffmpeg" why="It's needed to convert this file." />}
    </div>
  );
}
