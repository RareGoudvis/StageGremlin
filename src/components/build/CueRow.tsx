// One cue in the Build list: number, colour, name + one-line note, at most one badge, length.
// Everything else about a cue is in the tooltip, the inspector and the right-click menu.

import type { MouseEvent, PointerEvent } from "react";
import { memo } from "react";
import { useDoc } from "../../store";
import { useMedia } from "../../lib/media";
import { openMenu } from "../ContextMenu";
import { cueMenu } from "../../lib/menus";
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

  const badge = pickBadge();
  // Settings that no longer get their own tag: listed in the tooltip, changed via right-click.
  const extras = [
    attached && `starts by itself ${fmtTime(cue.attach!.at)} into another cue`,
    cue.preWait > 0 && `pre-wait ${fmtSecs(cue.preWait)}`,
    cue.fadeGo && `Fade & GO ${cue.fadeGo} s`,
    cue.swappedFrom && `swapped from ${cue.swappedFrom}`,
    cue.loudness && !norm.peakLimited && `${fmtDb(norm.gainDb)} to reach the target`,
  ].filter(Boolean);
  const line2 = fileDisplay === "path" ? [cue.file, cue.notes.sound].filter(Boolean).join(" · ") : cue.notes.sound || basename(cue.file);

  /** One badge at most, the most important one first: problems, then live state, then playback. */
  function pickBadge(): { text: string; cls: string; title?: string; pulse?: boolean } | null {
    if (missing) return { text: "FILE MISSING", cls: "tag-red", title: "The file is not on disk: open the cue to Locate it" };
    if (status?.state === "error") return { text: status.unsupported ? "CAN'T PLAY FORMAT" : "CAN'T READ", cls: "tag-red", title: status.message };
    if (status?.state === "busy") return { text: "ANALYSING…", cls: "", pulse: true };
    if (status?.state === "converting") return { text: "CONVERTING…", cls: "", pulse: true };
    if (playing) return { text: "PLAYING", cls: "tag-ok", pulse: true };
    if (standby) return { text: "STANDBY", cls: "tag-ok" };
    if (cue.playCount !== 1) return { text: cue.playCount === 0 ? "LOOP" : `×${cue.playCount}`, cls: "tag-cy" };
    if (cue.loudness && norm.peakLimited) return { text: `${fmtDb(norm.gainDb)} PEAK-LIMITED`, cls: "tag-amb", title: `${cue.loudness.lufs.toFixed(1)} LUFS measured` };
    if (!cue.loudness) return { text: "NOT ANALYSED", cls: "tag-amb" };
    return null;
  }

  return (
    <div
      data-cue-id={cue.id}
      data-section-id={sectionId}
      role="option"
      aria-selected={selected}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => openMenu(e, cueMenu(cue.id))}
      title={["Double-click (or Enter) to open the cue editor. Right-click for everything else.", ...extras].join("\n")}
      onPointerDown={onPointerDown}
      style={{
        display: "flex", alignItems: "center", gap: 12, minHeight: 52, padding: "6px 12px", margin: "2px 0", marginLeft: attached ? 34 : 0,
        borderRadius: 12, cursor: "default", opacity: dragging ? 0.4 : 1,
        background: selected ? "var(--p2)" : "transparent",
        boxShadow: selected ? "inset 0 0 0 1.5px var(--acc)" : standby ? "inset 3px 0 0 var(--acc)" : "none",
      }}
    >
      <span style={{ color: "var(--mute)", cursor: "grab", display: "flex" }} title="Drag to move"><Grip /></span>
      <span className="mono" style={{ fontSize: 14, fontWeight: 600, width: 40, color: attached ? "var(--amb)" : "var(--dim)" }}>
        {cue.number}
      </span>
      <span style={{ width: 10, height: 10, borderRadius: 5, flex: "none", background: cue.color ?? "var(--line)" }} />
      <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1, gap: 2 }}>
        <span className="clamp1" style={{ fontSize: 15, fontWeight: 600 }}>{cue.name || "(no name)"}</span>
        <span className={`clamp1 ${cue.notes.sound && fileDisplay !== "path" ? "" : "mono"}`} style={{ fontSize: 12, color: "var(--mute)" }}>{line2}</span>
      </span>
      {cue.follow.kind !== "none" && (
        <span title={cue.follow.kind === "afterEnd" ? "Next cue starts when this ends" : `Next cue starts ${cue.follow.delay} s after this starts`} style={{ color: "var(--acc)", display: "flex", alignItems: "center", gap: 2, flex: "none" }}>
          <Follow />
          {cue.follow.kind === "afterStart" && <span className="mono" style={{ fontSize: 11 }}>{fmtSecs(cue.follow.delay)}</span>}
        </span>
      )}
      {badge && <span className={`tag ${badge.cls} ${badge.pulse ? "pulse" : ""}`} title={badge.title} style={{ flex: "none" }}>{badge.text}</span>}
      <span className="mono" style={{ width: 52, textAlign: "right", fontSize: 14, color: "var(--text)", flex: "none" }}>{len != null ? fmtTime(len) : "–:––"}</span>
    </div>
  );
});
