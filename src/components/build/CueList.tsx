// The Build cue list: sections as foldable accordions, cue rows, and drag & drop.
//
// Drag & drop uses pointer events, not the browser's HTML5 drag API: in Tauri on
// Windows the webview's own file-drop handling swallows HTML5 drag events, and
// pointer events behave the same everywhere.

import { useRef, useState, type MouseEvent, type PointerEvent as RPointerEvent } from "react";
import { useDoc } from "../../store";
import { useEngine } from "../../engineStore";
import type { Section } from "../../types";
import { allCues } from "../../types";
import { moveCues, renameSection } from "../../lib/showOps";
import { call } from "../../lib/tauri";
import { fmtTime } from "../../lib/format";
import { cueRunLen } from "../../lib/showMath";
import { useUi } from "../../uiStore";
import { openMenu } from "../ContextMenu";
import { listMenu, sectionMenu } from "../../lib/menus";
import { useT } from "../../i18n";
import { cueMatches } from "./BuildToolbar";
import { Chevron } from "../Icons";
import { CueRow } from "./CueRow";

/** Where a drop would land: in `sectionId`, before `beforeId` (null = end of section). */
interface DropTarget { sectionId: string; beforeId: string | null }

const DRAG_THRESHOLD_PX = 5;

export function CueList() {
  const show = useDoc((s) => s.show);
  const selection = useDoc((s) => s.selection);
  const collapsed = useDoc((s) => s.collapsed);
  const find = useUi((s) => s.find).trim();
  const t = useT();
  const playhead = useEngine((s) => s.state?.playhead ?? null);
  // A joined string keeps this selector stable between 30 Hz updates.
  const runningIds = useEngine((s) => s.state?.running.map((r) => r.cueId).join(",") ?? "");
  const running = new Set(runningIds.split(",").filter(Boolean));

  const scrollRef = useRef<HTMLDivElement>(null);
  const pending = useRef<{ id: string; x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<{ ids: string[]; target: DropTarget | null } | null>(null);

  const order = allCues(show).map((c) => c.id);

  // ---- clicking ----
  const onRowClick = (id: string, e: MouseEvent) => {
    useDoc.getState().select(id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
    // A plain click also moves the engine's playhead there (attached cues can't stand by).
    const cue = allCues(useDoc.getState().show).find((c) => c.id === id);
    if (!e.ctrlKey && !e.shiftKey && cue && !cue.attach) void call("engine_set_playhead", { cueId: id });
  };

  // ---- dragging ----
  const onRowPointerDown = (id: string, e: RPointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button, input")) return;
    pending.current = { id, x: e.clientX, y: e.clientY };
  };

  const findTarget = (x: number, y: number): DropTarget | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const row = el?.closest<HTMLElement>("[data-cue-id]");
    if (row) {
      const sectionId = row.dataset.sectionId!;
      const r = row.getBoundingClientRect();
      if (y < r.top + r.height / 2) return { sectionId, beforeId: row.dataset.cueId! };
      // Lower half: before the next cue in the same section.
      const sec = show.sections.find((s) => s.id === sectionId);
      const i = sec?.cues.findIndex((c) => c.id === row.dataset.cueId) ?? -1;
      return { sectionId, beforeId: sec?.cues[i + 1]?.id ?? null };
    }
    const secEl = el?.closest<HTMLElement>("[data-drop-section]");
    if (secEl) {
      const sec = show.sections.find((s) => s.id === secEl.dataset.dropSection);
      // On a header: top of the section. On the empty area below: the end.
      const onHeader = !!el?.closest("[data-section-header]");
      return sec ? { sectionId: sec.id, beforeId: onHeader ? sec.cues[0]?.id ?? null : null } : null;
    }
    return null;
  };

  const onPointerMove = (e: RPointerEvent) => {
    const p = pending.current;
    if (p && !drag && Math.hypot(e.clientX - p.x, e.clientY - p.y) > DRAG_THRESHOLD_PX) {
      // Start dragging: the whole selection if the row is part of it, otherwise just this row.
      const sel = useDoc.getState().selection;
      const ids = sel.includes(p.id) ? [...sel].sort((a, b) => order.indexOf(a) - order.indexOf(b)) : [p.id];
      if (!sel.includes(p.id)) useDoc.getState().select(p.id);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setDrag({ ids, target: null });
      return;
    }
    if (!drag) return;
    // Auto-scroll near the top/bottom edge.
    const box = scrollRef.current?.getBoundingClientRect();
    if (box && scrollRef.current) {
      if (e.clientY < box.top + 40) scrollRef.current.scrollTop -= 12;
      else if (e.clientY > box.bottom - 40) scrollRef.current.scrollTop += 12;
    }
    let t = findTarget(e.clientX, e.clientY);
    // Dropping "before" one of the dragged cues means: before the next cue that isn't dragged.
    if (t?.beforeId && drag.ids.includes(t.beforeId)) {
      const sec = show.sections.find((s) => s.id === t!.sectionId)!;
      const i = sec.cues.findIndex((c) => c.id === t!.beforeId);
      t = { sectionId: sec.id, beforeId: sec.cues.slice(i).find((c) => !drag.ids.includes(c.id))?.id ?? null };
    }
    if (t?.sectionId !== drag.target?.sectionId || t?.beforeId !== drag.target?.beforeId) setDrag({ ...drag, target: t });
  };

  const onPointerUp = () => {
    pending.current = null;
    if (!drag) return;
    const t = drag.target;
    setDrag(null);
    if (t) useDoc.getState().edit((s) => moveCues(s, drag.ids, t.sectionId, t.beforeId));
  };

  const isDropLine = (sectionId: string, beforeId: string | null) =>
    !!drag?.target && drag.target.sectionId === sectionId && drag.target.beforeId === beforeId;

  return (
    <div
      ref={scrollRef}
      className="scroll"
      style={{ flex: 1, minHeight: 0, padding: "4px 10px 40px", cursor: drag ? "grabbing" : undefined }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { pending.current = null; setDrag(null); }}
      // Right-click on empty space (rows and headers have their own menus).
      onContextMenu={(e) => openMenu(e, listMenu())}
    >
      {show.sections.map((sec) => {
        // While searching, only matching cues show, in every section (folded or not).
        const cues = find ? sec.cues.filter((c) => cueMatches(c, find)) : sec.cues;
        if (find && !cues.length) return null;
        const open = !!find || !collapsed[sec.id];
        return (
          <div key={sec.id} data-drop-section={sec.id} style={{ paddingBottom: open ? 6 : 0 }}>
            <SectionHeader section={sec} open={open} />
            {open && cues.map((c) => (
              <div key={c.id}>
                {isDropLine(sec.id, c.id) && <DropLine />}
                <CueRow
                  cue={c}
                  sectionId={sec.id}
                  selected={selection.includes(c.id)}
                  standby={playhead === c.id}
                  playing={running.has(c.id)}
                  dragging={!!drag?.ids.includes(c.id)}
                  onClick={(e) => onRowClick(c.id, e)}
                  onDoubleClick={() => useUi.getState().openEditor(c.id)}
                  onPointerDown={(e) => onRowPointerDown(c.id, e)}
                />
              </div>
            ))}
            {open && isDropLine(sec.id, null) && <DropLine />}
            {open && !sec.cues.length && (
              <div style={{ padding: "10px 14px", margin: "0 0 4px 22px", borderRadius: 8, border: "1px dashed var(--line)", color: "var(--mute)", fontSize: 13 }}>
                {t("build.emptySection")}
              </div>
            )}
          </div>
        );
      })}
      {find && !allCues(show).some((c) => cueMatches(c, find)) && (
        <p style={{ padding: "18px 8px", color: "var(--mute)", fontSize: 14 }}>{t("build.noMatch")} “{find}”.</p>
      )}
    </div>
  );
}

function DropLine() {
  return <div aria-hidden="true" style={{ height: 3, margin: "-1px 0 -2px 20px", borderRadius: 2, background: "var(--acc)", position: "relative", zIndex: 2 }} />;
}

function SectionHeader({ section, open }: { section: Section; open: boolean }) {
  const [editing, setEditing] = useState(false);
  const total = section.cues.reduce((a, c) => a + (c.attach ? 0 : cueRunLen(c)), 0);
  const count = section.cues.filter((c) => !c.attach).length;

  const rename = (name: string) => {
    setEditing(false);
    const clean = name.trim();
    if (clean && clean !== section.name) useDoc.getState().edit((s) => renameSection(s, section.id, clean));
  };

  return (
    <div data-section-header onContextMenu={(e) => openMenu(e, sectionMenu(section.id, () => setEditing(true)))} style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 6px 6px" }}>
      <button
        className="b"
        aria-expanded={open}
        onClick={() => useDoc.getState().setCollapsed(section.id, open)}
        style={{ display: "flex", alignItems: "center", gap: 10, background: "transparent", padding: "2px 2px", flex: editing ? "none" : 1, minWidth: 0, textAlign: "left" }}
        onDoubleClick={() => setEditing(true)}
        title="Click to fold, double-click to rename, right-click for more"
      >
        <Chevron open={open} />
        {section.color && <span style={{ width: 10, height: 10, borderRadius: 5, background: section.color, flex: "none" }} />}
        {!editing && <span className="cond clamp1" style={{ fontSize: 15, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase" }}>{section.name}</span>}
        {!editing && <span style={{ flex: 1, height: 1, background: "var(--line)", minWidth: 20 }} />}
      </button>
      {editing && (
        <input
          className="input" autoFocus defaultValue={section.name} aria-label="Section name"
          onBlur={(e) => rename(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") rename((e.target as HTMLInputElement).value); if (e.key === "Escape") setEditing(false); }}
          style={{ flex: 1, fontWeight: 700 }}
        />
      )}
      <span className="mono" style={{ fontSize: 11.5, color: "var(--mute)", whiteSpace: "nowrap" }}>
        {count} cue{count === 1 ? "" : "s"} · {fmtTime(total)}
      </span>
    </div>
  );
}
