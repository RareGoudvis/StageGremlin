// What the Run buttons and keys do. One function per action, shared by both.

import { useDoc } from "../store";
import { ask, toast } from "../uiStore";
import { goQueue } from "../types";
import { findCue, moveBefore } from "./showOps";
import { call } from "./tauri";
import { flushShowToEngine } from "./engineSync";

export async function go() {
  try {
    const r = await call("engine_go");
    if (r === "endOfShow") toast("End of show: nothing is standing by");
  } catch (e) {
    toast(`GO failed: ${e}`);
  }
}

export const pauseAll = () => void call("engine_pause_all").catch((e) => toast(`Pause failed: ${e}`));
export const stopAll = () => void call("engine_stop_all");
export const panic = () => void call("engine_panic");
export const stopCue = (cueId: string) => void call("engine_stop_cue", { cueId });
export const toggleUnder = (cueId: string | null) => void call("engine_toggle_under", { cueId });
export const releaseVamp = (cueId: string | null) => void call("engine_release_vamp", { cueId });
export const skipTo = (cueId: string) => void call("engine_set_playhead", { cueId });
/** Rehearsal: start a cue at a moment in its file (a marker), moving the playhead past it. */
export const goFrom = (cueId: string, at: number) => void call("engine_go_from", { cueId, at });
export const firePad = (padId: string) => void call("engine_pad", { padId });

/** Keys 1–9 and 0 in Run. */
export function firePadByKey(key: string): boolean {
  const pad = useDoc.getState().show.pads.find((p) => p.hotkey === key);
  if (pad) firePad(pad.id);
  return !!pad;
}

/**
 * Make next: always asks first, naming the cue and how many cues it jumps over.
 * Confirming moves the cue in front of the one standing by and stands it by.
 */
export async function makeNext(cueId: string, standbyId: string | null) {
  const show = useDoc.getState().show;
  const cue = findCue(show, cueId);
  const standby = findCue(show, standbyId);
  if (!cue || !standby || cueId === standbyId) return;
  const q = goQueue(show).map((c) => c.id);
  const jumps = q.indexOf(cueId) - q.indexOf(standbyId!);
  const ok = await ask({
    title: `Make ${cue.number} next?`,
    body: jumps > 0
      ? `“${cue.number} ${cue.name}” jumps over ${jumps} cue${jumps === 1 ? "" : "s"} and moves in front of ${standby.number} ${standby.name}. The others keep their order.`
      : `“${cue.number} ${cue.name}” moves back in front of ${standby.number} ${standby.name}.`,
    confirmLabel: `Make ${cue.number} next`,
  });
  if (!ok) return;
  useDoc.getState().edit((s) => moveBefore(s, cueId, standbyId!), { allowInRun: true });
  // The engine must know the new order before we point its playhead at the moved cue.
  await flushShowToEngine();
  await call("engine_set_playhead", { cueId });
  toast(`${cue.name} is standing by`);
}
