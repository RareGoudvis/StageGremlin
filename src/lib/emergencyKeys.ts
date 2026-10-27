// Emergency keys in Run and Dumbo mode: Stop all and Panic must ALWAYS work, also while a dialog,
// a right-click menu, the search box or the PIN prompt is open.
//
// The rule (review #5):
// - Stop-all key with nothing open          → Stop all.
// - Esc while something is open             → only closes that thing (the dialog handles it), no Stop all.
// - The Stop-all key again within 500 ms    → Panic, ALWAYS, even if the first press closed a dialog.
// - A Stop-all key that is NOT Esc (rebound, e.g. F12) never doubles as "close", so it stops at once.
// - Space/Enter never fire GO through a dialog: that stays the dialogs' own business.
//
// One capture-phase listener, installed at start-up BEFORE any dialog adds its own, so it sees the
// key first; dialogs' stopImmediatePropagation can't hide an emergency press from it.

import { useDoc } from "../store";
import { useUi } from "../uiStore";
import { isAction, useSettings } from "../settingsStore";
import { useMenu } from "../components/ContextMenu";
import { panic, stopAll } from "./runActions";
import { previewStop, usePreview } from "./preview";
import { decideStopKey } from "./decisions";

// Overlays that live in a component's own state (Run's search box, Dumbo's PIN prompt) report here.
const localOverlays = new Set<string>();
export function setLocalOverlay(name: string, open: boolean) {
  if (open) localOverlays.add(name);
  else localOverlays.delete(name);
}

function overlayOpen(): boolean {
  const ui = useUi.getState();
  return Boolean(ui.confirm || ui.dialog || useMenu.getState().menu || localOverlays.size);
}

function inShowMode(): boolean {
  return useDoc.getState().mode === "run" || useSettings.getState().ui.dumbo;
}

let installed = false;

export function installEmergencyKeys() {
  if (installed) return;
  installed = true;
  let lastPress = 0;
  window.addEventListener(
    "keydown",
    (e) => {
      if (!inShowMode() || e.repeat || !isAction(e, "stopAll")) return;
      const d = decideStopKey({ now: performance.now(), lastPress, overlayOpen: overlayOpen(), isEscape: e.key === "Escape" });
      lastPress = d.lastPress;
      if (d.action === "closeOverlay") return; // the dialog/menu/search closes itself on this Esc
      e.preventDefault();
      e.stopImmediatePropagation();
      // It also stops a headphone preview (that never plays in the hall anyway).
      if (usePreview.getState().state?.playing) void previewStop();
      if (d.action === "panic") panic();
      else stopAll();
    },
    true,
  );
}
