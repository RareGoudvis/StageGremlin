// Build: edit the show. Toolbar on top, cue list (or pads grid) on the left, inspector on the right.

import { useEffect } from "react";
import { useDoc } from "../store";
import { useUi } from "../uiStore";
import { allCues } from "../types";
import { addSection, locate, moveBy } from "../lib/showOps";
import { exportZip, fileNew, fileOpen, fileSave, fileSaveAs, importDialog } from "../lib/fileActions";
import { findAnyCue } from "../lib/showOps";
import { previewToggle } from "../lib/preview";
import { PadGrid } from "../components/build/PadGrid";
import { isTauri } from "../lib/tauri";
import { loadDemoShow } from "../lib/demo";
import { CueList } from "../components/build/CueList";
import { Inspector, deleteCues } from "../components/build/Inspector";
import { BackgroundButton } from "../components/background/BackgroundPanel";

export function BuildView() {
  useBuildKeys();
  const tab = useDoc((s) => s.buildTab);
  return (
    <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) 420px" }}>
      <section aria-label="Show" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <Toolbar />
        {tab === "cues" ? <CueList /> : <PadGrid />}
      </section>
      <Inspector />
    </div>
  );
}

function Toolbar() {
  const name = useDoc((s) => s.show.name);
  const canUndo = useDoc((s) => s.past.length > 0);
  const canRedo = useDoc((s) => s.future.length > 0);
  const selCount = useDoc((s) => s.selection.length);
  const fileDisplay = useDoc((s) => s.fileDisplay);
  const anyOpen = useDoc((s) => s.show.sections.some((sec) => !s.collapsed[sec.id]));
  const tab = useDoc((s) => s.buildTab);
  const padCount = useDoc((s) => s.show.pads.length);
  const { edit, undo, redo, setAllCollapsed, toggleFileDisplay, setBuildTab } = useDoc.getState();

  const addSectionHere = () => {
    const s = useDoc.getState();
    const at = s.primary ? locate(s.show, s.primary)?.section.id : null;
    edit((show) => addSection(show, "New section", at));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 16px", borderBottom: "1px solid var(--line)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <input
          className="input cond"
          aria-label="Show name"
          value={name}
          onChange={(e) => edit((s) => ({ ...s, name: e.target.value }), { coalesce: "show-name" })}
          style={{ fontSize: 18, fontWeight: 800, letterSpacing: ".02em", height: 36, width: 260, background: "transparent", borderColor: "transparent" }}
        />
        <span style={{ flex: 1 }} />
        <BackgroundButton />
        <button className="b btn" onClick={() => void fileNew()} title="Ctrl+N">New</button>
        <button className="b btn" onClick={() => void fileOpen()} title="Ctrl+O">Open…</button>
        <button className="b btn" onClick={() => void fileSaveAs()} title="Ctrl+Shift+S">Save as…</button>
        <button className="b btn" onClick={() => void exportZip()} title="The show and its media in one zip">Export zip…</button>
        <button className="b btn btn-go" onClick={() => void fileSave()} title="Ctrl+S">Save</button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <div role="tablist" aria-label="Build panel" style={{ display: "flex", gap: 2, background: "var(--p2)", borderRadius: 9, padding: 3 }}>
          {(["cues", "pads"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className="b cond" onClick={() => setBuildTab(t)}
              style={{ height: 28, padding: "0 12px", borderRadius: 7, fontSize: 13, fontWeight: 800, letterSpacing: ".06em", background: tab === t ? "var(--hl)" : "transparent", color: tab === t ? "var(--bg)" : "var(--dim)" }}>
              {t === "cues" ? "CUES" : `PADS · ${padCount}`}
            </button>
          ))}
        </div>
        {tab === "cues" && (
          <>
            <button className="b btn btn-go" onClick={() => void importDialog()} title="Ctrl+I · or drop files on the window">+ Import audio</button>
            <button className="b btn" onClick={() => useUi.getState().openDialog({ kind: "youtube" })} title="Ctrl+Shift+Y">+ YouTube</button>
            <button className="b btn" onClick={addSectionHere}>+ Section</button>
            <button className="b btn" onClick={() => setAllCollapsed(anyOpen)}>{anyOpen ? "Collapse all" : "Expand all"}</button>
          </>
        )}
        {/* Background button: the background-player agent hooks its BackgroundButton in here. */}
        <span style={{ width: 1, height: 22, background: "var(--line)", margin: "0 4px" }} />
        <button className="b btn" disabled={!canUndo} onClick={undo} title="Ctrl+Z">Undo</button>
        <button className="b btn" disabled={!canRedo} onClick={redo} title="Ctrl+Y">Redo</button>
        {tab === "cues" && (
          <button className="b btn" disabled={!selCount} onClick={() => void deleteCues(useDoc.getState().selection)} title="Delete">
            Delete{selCount > 1 ? ` (${selCount})` : ""}
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button className="b btn" onClick={() => useUi.getState().openDialog({ kind: "print" })} title="Ctrl+P">Print sheet</button>
        <button className="b chip" aria-pressed={fileDisplay === "path"} onClick={toggleFileDisplay} title="Show full file paths in the list">Full paths</button>
        {!isTauri && (
          <button className="b btn" onClick={loadDemoShow} title="Browser preview only" style={{ background: "var(--cybg)", color: "var(--cytx)", border: "1px solid var(--cyline)" }}>
            Load demo show
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Keys for the cue list: ↑/↓ select, Alt+↑/↓ move, Delete removes, Ctrl+A selects all,
 * Enter opens the cue editor, H previews in the headphones.
 */
function useBuildKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const ui = useUi.getState();
      if (t.closest("input, textarea, select") || ui.confirm || ui.editorCueId || ui.dialog) return;
      const s = useDoc.getState();
      const order = allCues(s.show).map((c) => c.id);
      const current = s.buildTab === "pads" ? s.show.pads.find((p) => p.id === s.selectedPad)?.cue : findAnyCue(s.show, s.primary);

      if (e.key.toLowerCase() === "h" && !e.ctrlKey && !e.altKey && current) {
        e.preventDefault();
        previewToggle(current);
        return;
      }
      if (e.key === "Enter" && current) {
        e.preventDefault();
        ui.openEditor(current.id);
        return;
      }
      if (s.buildTab === "pads") return;

      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        if (s.selection.length) s.edit((show) => moveBy(show, s.selection, e.key === "ArrowUp" ? -1 : 1));
        return;
      }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const i = s.primary ? order.indexOf(s.primary) : -1;
        const j = Math.max(0, Math.min(order.length - 1, i + (e.key === "ArrowUp" ? -1 : 1)));
        if (order[j]) s.select(order[j], { shift: e.shiftKey });
        document.querySelector(`[data-cue-id="${order[j]}"]`)?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        void deleteCues(s.selection);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        s.setSelection(order);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
