// What the Run buttons and keys do. One function per action, shared by both.

import { useDoc } from "../store";
import { ask, toast } from "../uiStore";
import { goQueue } from "../types";
import { findCue, moveBefore } from "./showOps";
import { call } from "./tauri";
import { flushShowToEngine } from "./engineSync";
import { tr } from "../i18n";
import { create } from "zustand";

/**
 * GO lock-out: after a GO that fired, the engine ignores GO for show.settings.doubleGoMs.
 * The UI keeps the same window here so the GO buttons can show it (greyed, a bar running out).
 * `at` / `ms`: when the last GO fired (performance.now) and how long the lock lasts.
 */
export const useGoLock = create<{ at: number; ms: number }>(() => ({ at: 0, ms: 0 }));

export async function go() {
  try {
    const r = await call("engine_go");
    if (r === "endOfShow") toast(tr("r.act.endOfShow"));
    if (r === "fired") useGoLock.setState({ at: performance.now(), ms: useDoc.getState().show.settings.doubleGoMs });
  } catch (e) {
    toast(tr("r.act.goFailed", { e: String(e) }));
  }
}

export const pauseAll = () => void call("engine_pause_all").catch((e) => toast(tr("r.act.pauseFailed", { e: String(e) })));
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
    title: tr("r.act.makeNextTitle", { n: cue.number }),
    body: jumps > 0
      ? tr(jumps === 1 ? "r.act.jumps1" : "r.act.jumpsN", { cue: `${cue.number} ${cue.name}`, n: jumps, standby: `${standby.number} ${standby.name}` })
      : tr("r.act.movesBack", { cue: `${cue.number} ${cue.name}`, standby: `${standby.number} ${standby.name}` }),
    confirmLabel: tr("r.act.makeNextConfirm", { n: cue.number }),
  });
  if (!ok) return;
  useDoc.getState().edit((s) => moveBefore(s, cueId, standbyId!), { allowInRun: true });
  // The engine must know the new order before we point its playhead at the moved cue.
  await flushShowToEngine();
  await call("engine_set_playhead", { cueId });
  toast(tr("r.act.standingBy", { name: cue.name }));
}
