// One cue in the Build list: number, colour, name + file, timing hints, loudness badge, length.

import type { MouseEvent, PointerEvent } from "react";
import { memo } from "react";
import { useDoc } from "../../store";
import { useMedia } from "../../lib/media";
import type { Cue } from "../../types";
import { normGain, trimmedLen } from "../../types";
import { basename } from "../../lib/tauri";
import { fmtDb, fmtSecs, fmtTime } from "../../lib/format";
import { Follow, Grip } from "../Icons";

interface Props {
  cue: Cue;
  sectionId: string;
  selected: boolean;
  standby: boolean;
  playing: boolean;
  dragging: boolean;
  onClick: (e: MouseEvent) => void;
  onDoubleClick: () => void;
  onPointerDown: (e: PointerEvent) => void;
}

export const CueRow = memo(function CueRow({ cue, sectionId, selected, standby, playing, dragging, onClick, onDoubleClick, onPointerDown }: Props) {
  const settings = useDoc((s) => s.show.settings);
  const fileDisplay = useDoc((s) => s.fileDisplay);
  const status = useDoc((s) => s.analysis[cue.id]);
  const missing = useMedia((s) => !!s.missing[cue.id]);
  const norm = normGain(cue.loudness, settings);
  const len = trimmedLen(cue);
  const attached = !!cue.attach;

  return (
    <div
      data-cue-id={cue.id}
      data-section-id={sectionId}
      role="option"
      aria-selected={selected}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      title="Double-click (or Enter) to open the cue editor"
      onPointerDown={onPointerDown}
      style={{
        display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", marginLeft: attached ? 34 : 0,
        borderRadius: 10, cursor: "default", opacity: dragging ? 0.4 : 1,
        background: selected ? "var(--p2)" : "transparent",
        boxShadow: selected ? "inset 0 0 0 1px var(--acc)" : standby ? "inset 3px 0 0 var(--acc)" : "none",
      }}
    >
      <span style={{ color: "var(--mute)", cursor: "grab", display: "flex" }} title="Drag to move"><Grip /></span>
      <span className="mono" style={{ fontSize: 14, fontWeight: 600, width: 38, color: attached ? "var(--amb)" : "var(--text)" }}>
        {cue.number}
      </span>
      <span style={{ width: 10, height: 10, borderRadius: 5, flex: "none", background: cue.color ?? "var(--line)" }} />
      <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1, gap: 1 }}>
        <span style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
          <span className="clamp1" style={{ fontSize: 15, fontWeight: 600 }}>{cue.name || "(no name)"}</span>
          {standby && <span className="tag tag-ok">STANDBY</span>}
          {playing && <span className="tag tag-ok pulse">PLAYING</span>}
          {cue.swappedFrom && <span className="tag tag-amb" title={`Swapped from ${cue.swappedFrom}`}>SWAPPED</span>}
        </span>
        <span className="mono clamp1" style={{ fontSize: 11.5, color: "var(--mute)" }}>
          {fileDisplay === "path" ? cue.file : basename(cue.file)}
          {cue.notes.sound && <span style={{ color: "var(--dim)", fontFamily: "'Archivo Variable', sans-serif" }}> · {cue.notes.sound}</span>}
        </span>
      </span>

      {/* Timing hints */}
      <span style={{ display: "flex", gap: 4, alignItems: "center", flex: "none" }}>
        {attached && <span className="tag tag-amb" title="Starts by itself inside another cue">@{fmtTime(cue.attach!.at)}</span>}
        {cue.preWait > 0 && <span className="tag" title="Pre-wait">PRE {fmtSecs(cue.preWait)}</span>}
        {cue.playCount !== 1 && <span className="tag tag-cy">{cue.playCount === 0 ? "LOOP" : `×${cue.playCount}`}</span>}
        {cue.fadeGo && <span className="tag tag-amb" title="Fade & GO">F&GO {cue.fadeGo}s</span>}
        {cue.follow.kind !== "none" && (
          <span title={cue.follow.kind === "afterEnd" ? "Next cue starts when this ends" : `Next cue starts ${cue.follow.delay} s after this starts`} style={{ color: "var(--acc)", display: "flex", alignItems: "center", gap: 2 }}>
            <Follow />
            {cue.follow.kind === "afterStart" && <span className="mono" style={{ fontSize: 11 }}>{fmtSecs(cue.follow.delay)}</span>}
          </span>
        )}
      </span>

      {/* Loudness state */}
      <span style={{ width: 132, display: "flex", justifyContent: "flex-end", flex: "none" }}>
        {missing ? (
          <span className="tag tag-red" title="The file is not on disk: open the cue to Locate it">FILE MISSING</span>
        ) : status?.state === "busy" ? (
          <span className="tag pulse">ANALYSING…</span>
        ) : status?.state === "converting" ? (
          <span className="tag pulse">CONVERTING…</span>
        ) : status?.state === "error" ? (
          <span className="tag tag-red" title={status.message}>{status.unsupported ? "CAN'T PLAY FORMAT" : "MISSING"}</span>
        ) : cue.loudness ? (
          <span className={`tag ${norm.peakLimited ? "tag-amb" : ""}`} title={`${cue.loudness.lufs.toFixed(1)} LUFS measured`}>
            {fmtDb(norm.gainDb)}{norm.peakLimited ? " PEAK-LIMITED" : ""}
          </span>
        ) : (
          <span className="tag tag-amb">NOT ANALYSED</span>
        )}
      </span>
      <span className="mono" style={{ width: 48, textAlign: "right", fontSize: 13, color: "var(--dim)", flex: "none" }}>{len != null ? fmtTime(len) : "–:––"}</span>
    </div>
  );
});
