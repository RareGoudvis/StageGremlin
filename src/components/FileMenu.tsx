// The show name in the top bar doubles as the File menu (New, Open, Save, Export, Print, Settings).
// Double-click the name (or File › Rename show…) to rename the show in place.
// In Run the name is shown but the menu is off: Run is locked.

import { useState } from "react";
import { useDoc, useDirty } from "../store";
import { useUi } from "../uiStore";
import { keyFor, useSettings } from "../settingsStore";
import { exportZip, fileNew, fileOpen, fileOpenRecent, fileSave, fileSaveAs } from "../lib/fileActions";
import { basename, isTauri } from "../lib/tauri";
import { toggleMenuBelow, type MenuItem } from "./ContextMenu";
import { useT } from "../i18n";

export function FileMenuButton() {
  const t = useT();
  const name = useDoc((s) => s.show.name);
  const path = useDoc((s) => s.path);
  const mode = useDoc((s) => s.mode);
  const dirty = useDirty();
  const [renaming, setRenaming] = useState(false);
  const saved = !!path && !dirty;
  const locked = mode === "run";

  if (renaming) {
    return (
      <input
        className="input" autoFocus aria-label="Show name" defaultValue={name}
        onFocus={(e) => e.target.select()}
        onBlur={(e) => { rename(e.target.value); setRenaming(false); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setRenaming(false);
        }}
        style={{ height: 36, width: 260, fontSize: 14, fontWeight: 600 }}
      />
    );
  }

  const items = (): MenuItem[] => {
    const recent = useSettings.getState().ui.recent;
    return [
      { label: t("file.new"), shortcut: keyFor("newShow"), onClick: () => void fileNew() },
      { label: t("file.open"), shortcut: keyFor("open"), onClick: () => void fileOpen() },
      // A browser can't reopen a file by its path, so the recent list is only offered in the app.
      ...(isTauri
        ? [{
            label: t("file.recent"),
            submenu: recent.length
              ? recent.map((p) => ({ label: basename(p), onClick: () => void fileOpenRecent(p) }))
              : [{ label: t("file.noRecent"), disabled: true }],
          }]
        : []),
      "sep",
      { label: t("file.save"), shortcut: keyFor("save"), onClick: () => void fileSave() },
      { label: t("file.saveAs"), shortcut: keyFor("saveAs"), onClick: () => void fileSaveAs() },
      { label: t("file.exportZip"), onClick: () => void exportZip() },
      { label: t("file.rename"), onClick: () => setRenaming(true) },
      "sep",
      { label: t("file.print"), shortcut: keyFor("print"), onClick: () => useUi.getState().openDialog({ kind: "print" }) },
      { label: t("file.settings"), shortcut: keyFor("settings"), onClick: () => useUi.getState().openDialog({ kind: "settings" }) },
    ];
  };

  return (
    <button
      className="b tb-file" data-menu aria-label={t("top.fileMenu")} aria-haspopup="menu" disabled={locked}
      title={path ?? t("top.notSaved")}
      onClick={(e) => toggleMenuBelow(e.currentTarget, items())}
      onDoubleClick={() => !locked && setRenaming(true)}
      style={{ display: "flex", alignItems: "center", gap: 8, height: 36, padding: "0 12px", maxWidth: 340, border: "1px solid var(--line)", borderRadius: 8, background: "var(--p1)", color: "var(--text)", fontSize: 14, fontWeight: 600, opacity: 1, cursor: locked ? "default" : "pointer" }}
    >
      <span className="clamp1">{name || "Show"}</span>
      <span style={{ color: saved ? "var(--dim)" : "var(--amb)", fontWeight: 400, whiteSpace: "nowrap" }}>· {saved ? t("top.saved") : t("top.unsaved")}</span>
      {!locked && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      )}
    </button>
  );
}

function rename(value: string) {
  const name = value.trim();
  if (!name || name === useDoc.getState().show.name) return;
  useDoc.getState().edit((s) => ({ ...s, name }));
}
