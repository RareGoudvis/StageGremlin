// Build › media bin (left of the cue list): every audio file the show uses, plus files seen
// in the show folder that no cue uses yet. Filter on problems. Drag a file onto the cue list
// to make a cue (pointer events, like the cue list's own drag & drop).

import { useState, type PointerEvent as RPointerEvent } from "react";
import { useDoc } from "../../store";
import type { Cue } from "../../types";
import { allCues, normGain } from "../../types";
import { useMedia } from "../../lib/media";
import { addCuesForFiles } from "../../lib/fileActions";
import { absolutePath, basename, stripExt } from "../../lib/tauri";
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

export function MediaBin({ onClose }: { onClose: () => void }) {
  const t = useT();
  const show = useDoc((s) => s.show);
  const path = useDoc((s) => s.path);
  const analysis = useDoc((s) => s.analysis);
  const missing = useMedia((s) => s.missing);
  const seen = useMedia((s) => s.seen);
  const fileDisplay = useDoc((s) => s.fileDisplay);
  const [filter, setFilter] = useState<Filter>("all");
  const [drag, setDrag] = useState<{ file: string; x: number; y: number } | null>(null);

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

  // ---- drag a file onto the cue list ----
  const onDown = (file: string) => (e: RPointerEvent) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ file, x: e.clientX, y: e.clientY });
  };
  const onMove = (e: RPointerEvent) => drag && setDrag({ ...drag, x: e.clientX, y: e.clientY });
  const onUp = (e: RPointerEvent) => {
    if (!drag) return;
    const file = drag.file;
    setDrag(null);
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const row = el?.closest<HTMLElement>("[data-cue-id]");
    const sec = el?.closest<HTMLElement>("[data-drop-section]");
    if (!row && !sec) return; // dropped back on the bin: nothing to do
    const [cue] = addCuesForFiles([{ file, name: stripExt(basename(file)) }], row?.dataset.cueId ?? null, row ? undefined : sec?.dataset.dropSection);
    useDoc.getState().setSelection([cue.id]);
  };

  return (
    <aside aria-label="Media bin" style={{ borderRight: "1px solid var(--line)", background: "var(--p1)", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8, borderBottom: "1px solid var(--line)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="k" style={{ flex: 1 }}>{t("build.bin")} · {byFile.size}</span>
          <button className="b btn btn-ghost" style={{ height: 24, fontSize: 12, padding: "0 6px" }} onClick={onClose} title="Hide the media bin">◀</button>
        </div>
        <div role="group" aria-label="Filter" className="chips">
          {(["all", "used", "unused", "problems"] as Filter[]).map((f) => (
            <button key={f} className="b chip" aria-pressed={filter === f} onClick={() => setFilter(f)} style={{ height: 26, fontSize: 11.5, padding: "0 8px" }}>
              {f === "all" ? "All" : f === "used" ? "Used" : f === "unused" ? "Unused" : "Problems"}
            </button>
          ))}
        </div>
      </div>
      <div className="scroll" style={{ flex: 1, minHeight: 0, padding: 6, display: "flex", flexDirection: "column", gap: 2 }}>
        {items.map((i) => (
          <div key={i.file} onPointerDown={onDown(i.file)} onPointerMove={onMove} onPointerUp={onUp} title={i.hint ?? "Drag onto the cue list to make a cue"}
            style={{ padding: "7px 8px", borderRadius: 8, cursor: "grab", background: i.problems.includes("missing") ? "var(--redbg)" : "transparent", display: "flex", flexDirection: "column", gap: 2 }}>
            <span className="mono clamp1" style={{ fontSize: 12 }}>{fileDisplay === "path" ? i.file : basename(i.file)}</span>
            <span style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, color: "var(--mute)" }}>
                {i.users.length ? `${i.users.map((u) => u.number || "pad").join(", ")}` : "unused"}{i.duration ? ` · ${fmtTime(i.duration)}` : ""}
              </span>
              {i.problems.map((p) => (
                <span key={p} className={`tag ${p === "missing" || p.startsWith("can't") ? "tag-red" : "tag-amb"}`} style={{ fontSize: 9.5 }}>{p.toUpperCase()}</span>
              ))}
            </span>
            {i.hint && <span style={{ fontSize: 11, color: "var(--ambtx)" }}>{i.hint}</span>}
          </div>
        ))}
        {!items.length && <span style={{ padding: 10, fontSize: 12.5, color: "var(--mute)" }}>Nothing here{filter === "problems" ? ": no problems" : ""}.</span>}
      </div>
      <div style={{ padding: "8px 12px", borderTop: "1px solid var(--line)", fontSize: 11.5, color: "var(--mute)" }}>
        Drag a file onto the cue list to add it as a cue.
      </div>
      {drag && (
        <span className="mono" style={{ position: "fixed", left: drag.x + 12, top: drag.y + 8, zIndex: 70, padding: "4px 10px", borderRadius: 7, background: "var(--hl)", color: "var(--bg)", fontSize: 12, pointerEvents: "none" }}>
          + {basename(drag.file)}
        </span>
      )}
    </aside>
  );
}
