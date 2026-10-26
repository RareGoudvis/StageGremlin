// Show-length sums shared by the progress bar, the section rail and up next.

import type { Cue, RunningInfo } from "../types";
import { passLen } from "../types";

/** How long a cue keeps the show busy: one pass × play count (a loop counts as one pass). */
export function cueRunLen(c: Cue): number {
  return passLen(c) * Math.max(1, c.playCount);
}

/** Running show cues (pads are not part of the show order, they light up in the dock). */
export function showRunning(running: RunningInfo[] | undefined): RunningInfo[] {
  return (running ?? []).filter((r) => !r.padId);
}

/** The cue the now-playing card follows: the most recent running cue that is not attached or stopping. */
export function mainRunning(running: RunningInfo[] | undefined): RunningInfo | null {
  const cues = showRunning(running);
  if (!cues.length) return null;
  const main = cues.filter((r) => !r.attached && !r.stopping);
  return main[main.length - 1] ?? cues[cues.length - 1];
}
