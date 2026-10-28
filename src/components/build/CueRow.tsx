// One cue in the Build list, drawn as a small card: number, colour, name + one-line note, at most one badge,
// length. Selected = accent border; standby = accent number + STANDBY badge.
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
import { tr, useT } from "../../i18n";

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
  const t = useT();
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
    attached && t("i.row.attached", { at: fmtTime(cue.attach!.at) }),
    cue.preWait > 0 && t("i.row.preWait", { s: fmtSecs(cue.preWait) }),
    cue.exclusive === "stop" && t("i.row.exclStop"),
    cue.exclusive === "fade" && t("i.row.exclFade", { s: cue.exclusiveSecs }),
    cue.exclusive === "crossfade" && t("i.row.exclCross", { s: cue.exclusiveSecs }),
    cue.swappedFrom && t("i.row.swapped", { file: cue.swappedFrom }),
    cue.loudness && !norm.peakLimited && t("i.row.toTarget", { db: fmtDb(norm.gainDb) }),
  ].filter(Boolean);
  const line2 = fileDisplay === "path" ? [cue.file, cue.notes.sound].filter(Boolean).join(" · ") : cue.notes.sound || basename(cue.file);

  /** One badge at most, the most important one first: problems, then live state, then playback. */
  function pickBadge(): { text: string; cls: string; title?: string; pulse?: boolean } | null {
    if (missing) return { text: tr("i.row.missing"), cls: "tag-red", title: tr("i.row.missingHint") };
    if (status?.state === "error") return { text: status.unsupported ? tr("i.row.cantPlay") : tr("i.row.cantRead"), cls: "tag-red", title: status.message };
    if (status?.state === "busy") return { text: tr("i.row.analysing"), cls: "", pulse: true };
    if (status?.state === "converting") return { text: tr("i.row.converting"), cls: "", pulse: true };
    if (playing) return { text: tr("i.row.playing"), cls: "tag-ok", pulse: true };
    if (standby) return { text: tr("i.row.standby"), cls: "tag-ok" };
    if (cue.playCount !== 1) return { text: cue.playCount === 0 ? tr("i.row.loop") : `×${cue.playCount}`, cls: "tag-cy" };
    if (cue.loudness && norm.peakLimited) return { text: tr("i.row.peakLimited", { db: fmtDb(norm.gainDb) }), cls: "tag-amb", title: tr("i.row.measured", { lufs: cue.loudness.lufs.toFixed(1) }) };
    if (!cue.loudness) return { text: tr("i.row.notAnalysed"), cls: "tag-amb" };
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
      title={[t("i.row.hint"), ...extras].join("\n")}
      onPointerDown={onPointerDown}
      style={{
        display: "flex", alignItems: "center", gap: 12, minHeight: 52, padding: "6px 12px", margin: "0 0 6px", marginLeft: attached ? 34 : 0,
        borderRadius: 10, cursor: "default", opacity: dragging ? 0.4 : 1,
        background: selected ? "var(--p2)" : "var(--p1)",
        border: `1px solid ${selected ? "var(--acc)" : "var(--line)"}`,
      }}
    >
      <span style={{ color: "var(--mute)", cursor: "grab", display: "flex" }} title={t("i.row.drag")}><Grip /></span>
      <span className="mono" style={{ fontSize: 14, fontWeight: 600, width: 40, color: standby ? "var(--acc)" : attached ? "var(--amb)" : "var(--dim)" }}>
        {cue.number}
      </span>
      <span style={{ width: 10, height: 10, borderRadius: 5, flex: "none", background: cue.color ?? "var(--line)" }} />
      <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1, gap: 2 }}>
        <span className="clamp1" style={{ fontSize: 15, fontWeight: 600 }}>{cue.name || t("i.row.noName")}</span>
        <span className={`clamp1 ${cue.notes.sound && fileDisplay !== "path" ? "" : "mono"}`} style={{ fontSize: 12, color: "var(--mute)" }}>{line2}</span>
      </span>
      {cue.follow.kind !== "none" && (
        <span title={cue.follow.kind === "afterEnd" ? t("i.row.followEnd") : t("i.row.followAfter", { s: cue.follow.delay })} style={{ color: "var(--acc)", display: "flex", alignItems: "center", gap: 2, flex: "none" }}>
          <Follow />
          {cue.follow.kind === "afterStart" && <span className="mono" style={{ fontSize: 11 }}>{fmtSecs(cue.follow.delay)}</span>}
        </span>
      )}
      {badge && <span className={`tag ${badge.cls} ${badge.pulse ? "pulse" : ""}`} title={badge.title} style={{ flex: "none" }}>{badge.text}</span>}
      <span className="mono" style={{ width: 52, textAlign: "right", fontSize: 14, color: "var(--text)", flex: "none" }}>{len != null ? fmtTime(len) : "–:––"}</span>
    </div>
  );
});
