// Build's one toolbar: + Add · search · Undo · Redo · View ▾.
// When two or more cues are selected, the selection bar takes its place (see SelectionBar.tsx).
// Everything that used to be a button here now lives in the File menu, the View menu or right-click.

import { useDoc } from "../../store";
import { ask, useUi } from "../../uiStore";
import { keyFor } from "../../settingsStore";
import { renumber, allCues } from "../../types";
import { addSection, locate } from "../../lib/showOps";
import { isTauri, basename } from "../../lib/tauri";
import { loadDemoShow } from "../../lib/demo";
import { useT } from "../../i18n";
import type { Cue } from "../../types";
import { toggleMenuBelow, type MenuItem } from "../ContextMenu";
import { Caret, Plus, RedoIcon, Search, UndoIcon } from "../Icons";

/** Does this cue match the search text? Looks at number, name, notes and file name. */
export function cueMatches(cue: Cue, find: string): boolean {
  const q = find.trim().toLowerCase();
  if (!q) return true;
  const hay = [cue.number, cue.name, cue.notes.sound, cue.notes.lx, cue.notes.stage, basename(cue.file)].join(" ").toLowerCase();
  return hay.includes(q);
}

export function BuildToolbar() {
  const t = useT();
  const canUndo = useDoc((s) => s.past.length > 0);
  const canRedo = useDoc((s) => s.future.length > 0);
  const tab = useDoc((s) => s.buildTab);
  const find = useUi((s) => s.find);
  const { undo, redo } = useDoc.getState();

  const onFindKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      useUi.getState().setFind("");
      e.currentTarget.blur();
    }
    if (e.key === "Enter") {
      // Jump to the first match and leave the field, so arrow keys move through the list again.
      const first = allCues(useDoc.getState().show).find((c) => cueMatches(c, find));
      if (first) {
        useDoc.getState().select(first.id);
        document.querySelector(`[data-cue-id="${first.id}"]`)?.scrollIntoView({ block: "nearest" });
      }
      e.currentTarget.blur();
    }
  };

  return (
    <div style={{ height: 64, flex: "none", display: "flex", alignItems: "center", gap: 10, padding: "0 16px", borderBottom: "1px solid var(--line)" }}>
      <button className="b btn btn-go" onClick={() => useUi.getState().openDialog({ kind: "add" })} title={keyFor("importAudio")} style={{ height: 40, padding: "0 16px", borderRadius: 10, fontSize: 14 }}>
        <Plus /> {t("build.add")}
      </button>
      {tab === "cues" && (
        <label style={{ flex: 1, maxWidth: 420, display: "flex", alignItems: "center", gap: 8, height: 40, padding: "0 12px", border: "1px solid var(--line)", borderRadius: 10, background: "var(--p1)", color: "var(--mute)" }}>
          <Search size={16} />
          <input
            id="cue-find" value={find} onChange={(e) => useUi.getState().setFind(e.target.value)} onKeyDown={onFindKey}
            placeholder={`${t("build.find")}   ${keyFor("find")}`} aria-label={t("build.find")}
            style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", font: "inherit", fontSize: 14, color: "var(--text)" }}
          />
        </label>
      )}
      <span style={{ flex: 1 }} />
      <button className="b btn btn-icon" disabled={!canUndo} onClick={undo} aria-label={t("build.undo")} title={`${t("build.undo")} · ${keyFor("undo")}`} style={{ width: 40, height: 40 }}>
        <UndoIcon />
      </button>
      <button className="b btn btn-icon" disabled={!canRedo} onClick={redo} aria-label={t("build.redo")} title={`${t("build.redo")} · ${keyFor("redo")}`} style={{ width: 40, height: 40 }}>
        <RedoIcon />
      </button>
      <button className="b btn" data-menu aria-haspopup="menu" onClick={(e) => toggleMenuBelow(e.currentTarget, viewMenu(t))} style={{ height: 40 }}>
        {t("build.view")} <Caret />
      </button>
    </div>
  );
}

function viewMenu(t: ReturnType<typeof useT>): MenuItem[] {
  const s = useDoc.getState();
  const anyOpen = s.show.sections.some((sec) => !s.collapsed[sec.id]);
  return [
    { label: anyOpen ? t("view.collapseAll") : t("view.expandAll"), onClick: () => s.setAllCollapsed(anyOpen) },
    { label: t("view.fullPaths"), checked: s.fileDisplay === "path", onClick: s.toggleFileDisplay },
    { label: t("view.renumber"), onClick: () => void renumberAll() },
    "sep",
    { label: t("view.newSection"), onClick: addSectionHere },
    // The browser preview has no files to open, so it gets a demo show to click around in.
    ...(!isTauri ? ["sep" as const, { label: t("view.demo"), onClick: loadDemoShow }] : []),
  ];
}

/** New section right after the one holding the selected cue (or at the end). */
function addSectionHere() {
  const s = useDoc.getState();
  const at = s.primary ? locate(s.show, s.primary)?.section.id : null;
  s.edit((show) => addSection(show, "New section", at));
}

async function renumberAll() {
  const ok = await ask({ title: "Renumber all cues?", body: "Every cue gets a new number in show order (1, 2, 3…; attached cues 1.1, 1.2…). Your own numbers like 2.5 are replaced. Undo brings them back.", confirmLabel: "Renumber all" });
  if (ok) useDoc.getState().edit(renumber);
}
