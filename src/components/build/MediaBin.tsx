// Build › Media (left rail): every audio file the show uses, plus files seen in the show folder
// that no cue uses yet. Filter on problems. "Add to show" (or right-click) turns a file into a cue;
// new files come in by dragging them from Windows Explorer onto the window.

import { useState } from "react";
import { useDoc } from "../../store";
import type { Cue } from "../../types";
import { allCues, normGain } from "../../types";
import { useMedia } from "../../lib/media";
import { addCuesForFiles, importPadFiles, lastSelected } from "../../lib/fileActions";
import { absolutePath, basename, stripExt } from "../../lib/tauri";
import { toast } from "../../uiStore";
import { openMenu } from "../ContextMenu";
import { fmtTime } from "../../lib/format";
import { useT } from "../../i18n";

type Filter = "all" | "used" | "unused" | "problems";

interface BinItem {
  file: string;
  users: Cue[];
  problems: string[];
  hint?: string;
  duration: number | null;
}

const WIDE_LRA = 15;

export function MediaBin() {
  const t = useT();
  const show = useDoc((s) => s.show);
  const path = useDoc((s) => s.path);
  const analysis = useDoc((s) => s.analysis);
  const missing = useMedia((s) => s.missing);
  const seen = useMedia((s) => s.seen);
  const fileDisplay = useDoc((s) => s.fileDisplay);
  const [filter, setFilter] = useState<Filter>("all");

  // One item per file (several cues may share a file).
  const byFile = new Map<string, BinItem>();
  for (const c of [...allCues(show), ...show.pads.map((p) => p.cue)]) {
    if (!c.file) continue;
    const key = absolutePath(c.file, path);
    const item = byFile.get(key) ?? { file: c.file, users: [], problems: [], duration: c.loudness?.duration ?? null };
    item.users.push(c);
    const st = analysis[c.id];
    if (missing[c.id]) item.problems.push("missing");
    else if (st?.state === "error") item.problems.push(st.unsupported ? "can't play format" : "can't decode");
    else if (!c.loudness && st?.state !== "busy") item.problems.push("not analysed");
    if (c.loudness && normGain(c.loudness, show.settings).peakLimited) item.problems.push("peak-limited");
    if (c.loudness && c.loudness.lra > WIDE_LRA) {
      item.problems.push(`wide range ${c.loudness.lra.toFixed(0)} LU`);
      item.hint = "Quiet and loud parts differ a lot: add the compressor (Light or Medium).";
    }
    item.problems = [...new Set(item.problems)];
    byFile.set(key, item);
  }
  for (const f of seen) {
    if (!byFile.has(absolutePath(f, path))) byFile.set(f, { file: f, users: [], problems: [], duration: null });
  }
  const items = [...byFile.values()].filter((i) =>
    filter === "used" ? i.users.length > 0 : filter === "unused" ? i.users.length === 0 : filter === "problems" ? i.problems.length > 0 : true,
  );

  const filterLabel = { all: t("media.all"), used: t("media.used"), unused: t("media.unused"), problems: t("media.problems") };

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "10px 20px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid var(--line)" }}>
        <span className="k">{t("rail.media")} · {byFile.size}</span>
        <div role="group" aria-label="Filter" className="chips">
          {(["all", "used", "unused", "problems"] as Filter[]).map((f) => (
            <button key={f} className="b chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>{filterLabel[f]}</button>
          ))}
        </div>
      </div>
      <div className="scroll" style={{ flex: 1, minHeight: 0, padding: "8px 14px", display: "flex", flexDirection: "column", gap: 2 }}>
        {items.map((i) => (
          <div key={i.file} title={i.hint}
            onContextMenu={(e) => openMenu(e, [
              { label: t("media.add"), onClick: () => addToShow(i.file) },
              { label: t("media.addPad"), onClick: () => importPadFiles([i.file]) },
            ])}
            style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 50, padding: "6px 10px", borderRadius: 10, background: i.problems.includes("missing") ? "var(--redbg)" : "transparent" }}>
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <span className="mono clamp1" style={{ fontSize: 13 }}>{fileDisplay === "path" ? i.file : basename(i.file)}</span>
              <span style={{ fontSize: 12, color: "var(--mute)" }}>
                {i.users.length ? `${i.users.map((u) => u.number || "pad").join(", ")}` : t("media.notUsed")}
                {i.hint && <span style={{ color: "var(--ambtx)" }}> · {i.hint}</span>}
              </span>
            </span>
            {i.problems.map((p) => (
              <span key={p} className={`tag ${p === "missing" || p.startsWith("can't") ? "tag-red" : "tag-amb"}`}>{p.toUpperCase()}</span>
            ))}
            <span className="mono" style={{ width: 48, textAlign: "right", fontSize: 13, color: "var(--dim)" }}>{i.duration ? fmtTime(i.duration) : ""}</span>
            <button className="b btn" onClick={() => addToShow(i.file)} disabled={i.problems.includes("missing")}>+ {t("media.add")}</button>
          </div>
        ))}
        {!items.length && <span style={{ padding: 10, fontSize: 13, color: "var(--mute)" }}>{t("media.nothing")}</span>}
      </div>
      <p style={{ margin: 0, padding: "8px 20px", fontSize: 12, color: "var(--mute)", borderTop: "1px solid var(--line)" }}>{t("media.dropHint")}</p>
    </div>
  );
}

/** A file from the bin becomes a new cue after the selected cue, and gets selected. */
function addToShow(file: string) {
  const [cue] = addCuesForFiles([{ file, name: stripExt(basename(file)) }], lastSelected());
  useDoc.getState().setSelection([cue.id]);
  toast(`Added “${cue.name}” as cue ${useDoc.getState().show.sections.flatMap((s) => s.cues).find((c) => c.id === cue.id)?.number ?? ""}`);
}
