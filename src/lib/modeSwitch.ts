// Switching between Build / Preflight / Run (and Background).
// Leaving Run must be deliberate: press the shortcut twice, or hold the button ~1 s.

import { useDoc, type Mode } from "../store";
import { toast } from "../uiStore";
import { canEnterRun } from "./media";
import { tr, type TKey } from "../i18n";

const DOUBLE_PRESS_MS = 1500;
let armed: { mode: Mode; at: number } | null = null;

const KEY_FOR: Record<Mode, string> = { build: "Ctrl+1", preflight: "Ctrl+2", run: "Ctrl+3", background: "Ctrl+4" };

/** From the keyboard (Ctrl+1/2/3). */
export function requestModeByKey(mode: Mode) {
  const cur = useDoc.getState().mode;
  if (cur === mode) return;
  if (mode === "run" && !canEnterRun()) return;
  if (cur !== "run") return useDoc.getState().setMode(mode);
  const now = Date.now();
  if (armed && armed.mode === mode && now - armed.at < DOUBLE_PRESS_MS) {
    armed = null;
    useDoc.getState().setMode(mode);
  } else {
    armed = { mode, at: now };
    toast(tr("m.mode.pressAgain", { key: KEY_FOR[mode] }));
  }
}

/** From a short click on the mode switch. In Run this only explains how to leave. */
export function requestModeByClick(mode: Mode) {
  const cur = useDoc.getState().mode;
  if (cur === mode) return;
  // The mode's name as on its button (mode.build = BUILD / BOUWEN).
  if (cur === "run") toast(tr("m.mode.holdToLeave", { mode: tr(`mode.${mode}` as TKey), key: KEY_FOR[mode] }));
  else if (mode !== "run" || canEnterRun()) useDoc.getState().setMode(mode);
}

/** After the button has been held long enough. */
export function forceMode(mode: Mode) {
  armed = null;
  useDoc.getState().setMode(mode);
}

export const HOLD_TO_LEAVE_MS = 900;
