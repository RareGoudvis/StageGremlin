// Keyboard shortcuts that work on every screen. Keys come from the keymap in
// settingsStore.ts, so the operator can rebind them in Settings.
// Screen-specific keys live in their view (Run's GO keys in RunView, cue list keys in BuildView).

import { useEffect } from "react";
import { useDoc } from "../store";
import { useUi } from "../uiStore";
import { requestModeByKey } from "../lib/modeSwitch";
import { fileNew, fileOpen, fileSave, fileSaveAs, importDialog } from "../lib/fileActions";
import { isAction, type Action } from "../settingsStore";

export function useAppShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Plain letters belong to the screens (and to text fields); app shortcuts use a modifier.
      if (!(e.ctrlKey || e.metaKey || e.altKey)) return;
      const ui = useUi.getState();
      if (ui.dialog?.kind === "settings") return; // the shortcut editor is listening
      const { mode, undo, redo, cycleTheme } = useDoc.getState();
      const hit = (a: Action, fn: () => unknown) => {
        if (!isAction(e, a)) return false;
        e.preventDefault();
        void fn();
        return true;
      };

      // Switching screens (leaving Run needs a double press: see modeSwitch.ts).
      if (hit("modeBuild", () => requestModeByKey("build"))) return;
      if (hit("modePreflight", () => requestModeByKey("preflight"))) return;
      if (hit("modeRun", () => requestModeByKey("run"))) return;

      // Booth and printing work everywhere.
      if (hit("theme", cycleTheme)) return;
      if (hit("redMode", () => ui.setBooth({ red: !ui.booth.red }))) return;
      if (hit("bigMode", () => ui.setBooth({ big: !ui.booth.big }))) return;
      if (hit("print", () => ui.openDialog({ kind: "print" }))) return;

      // Everything below edits or replaces the show: not in Run.
      if (mode === "run") return;
      if (mode === "build" && hit("youtube", () => ui.openDialog({ kind: "youtube" }))) return;
      if (mode === "build" && hit("importAudio", importDialog)) return;
      if (hit("saveAs", fileSaveAs)) return;
      if (hit("save", fileSave)) return;
      if (hit("open", fileOpen)) return;
      if (hit("newShow", fileNew)) return;
      if (hit("redo", redo)) return;
      // Ctrl+Shift+Z also redoes, whatever Redo is bound to.
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "z") { e.preventDefault(); redo(); return; }
      hit("undo", undo);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
