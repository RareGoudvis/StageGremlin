// Keyboard shortcuts that work on every screen (Ctrl+…). Screen-specific keys
// live in their view (Run's GO keys are in RunView, cue list keys in BuildView).

import { useEffect } from "react";
import { useDoc } from "../store";
import { useUi } from "../uiStore";
import { requestModeByKey } from "../lib/modeSwitch";
import { fileNew, fileOpen, fileSave, fileSaveAs, importDialog } from "../lib/fileActions";

export function useAppShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      const { mode, undo, redo } = useDoc.getState();

      // Ctrl+1/2/3 switch screens (leaving Run needs a double press: see modeSwitch.ts).
      const modeKey = ({ "1": "build", "2": "preflight", "3": "run" } as const)[e.code.replace("Digit", "").replace("Numpad", "") as "1" | "2" | "3"];
      if (modeKey) {
        e.preventDefault();
        requestModeByKey(modeKey);
        return;
      }
      const ui = useUi.getState();
      // Booth keys work everywhere.
      if (k === "t" && !e.shiftKey) { e.preventDefault(); useDoc.getState().cycleTheme(); return; }
      if (k === "r" && e.shiftKey) { e.preventDefault(); ui.setBooth({ red: !ui.booth.red }); return; }
      if (k === "b" && !e.shiftKey) { e.preventDefault(); ui.setBooth({ big: !ui.booth.big }); return; }
      if (k === "p" && !e.shiftKey) { e.preventDefault(); ui.openDialog({ kind: "print" }); return; }
      // Everything below edits or replaces the show: not in Run.
      if (mode === "run") return;
      if (k === "y" && e.shiftKey && mode === "build") { e.preventDefault(); ui.openDialog({ kind: "youtube" }); return; }
      const run = (fn: () => unknown) => { e.preventDefault(); void fn(); };
      if (k === "s" && e.shiftKey) return run(fileSaveAs);
      if (k === "s") return run(fileSave);
      if (k === "o") return run(fileOpen);
      if (k === "n") return run(fileNew);
      if (k === "i" && mode === "build") return run(importDialog);
      if ((k === "z" && e.shiftKey) || k === "y") return run(redo);
      if (k === "z") return run(undo);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
