// Live state streamed by the engine (~30 Hz) plus the output device status and
// rehearsal bookkeeping. Kept apart from the editor store so meters ticking never
// re-render the cue list. Components should select only what they need,
// e.g. useEngine((s) => s.state?.playhead).

import { create } from "zustand";
import type { EngineState, LogEntry, OutputStatus } from "./types";

const LOG_CAP = 500;

/** A log line plus whether it happened during a rehearsal. */
export interface ShowLogEntry extends LogEntry { rehearsal: boolean }

interface EngineStore {
  state: EngineState | null;
  /** Every log line received this session (the engine only sends new ones). */
  log: ShowLogEntry[];
  output: OutputStatus | null;
  /**
   * True only when the chosen output (the Qu-24) WAS connected this session and then disappeared
   * (a USB dropout mid-show): that's worth a red banner. Never connected (at home, not plugged in
   * yet) is not an error: we simply play on the Windows default until it shows up.
   */
  outputLost: boolean;
  lastError: string | null;

  /** Rehearsal mode: start anywhere, log lines are tagged, real durations are measured. */
  rehearsal: boolean;
  /** Seconds each cue really played during rehearsal (memory only). */
  measured: Record<string, number>;
  /** Measured times adopted as the plan (used by the progress bar and the cue sheet). */
  plan: Record<string, number> | null;

  receive: (s: EngineState) => void;
  setOutput: (o: OutputStatus) => void;
  setError: (e: string | null) => void;
  setRehearsal: (on: boolean) => void;
  adoptPlan: () => void;
  clearPlan: () => void;
}

/** How far each running instance got, to measure it when it stops. */
/** The chosen output's name the last time it was connected (see outputLost). */
let seenPreferred: string | null = null;

const lastSeen = new Map<number, { cueId: string; played: number; pad: boolean }>();

export const useEngine = create<EngineStore>((set, get) => ({
  state: null,
  log: [],
  output: null,
  outputLost: false,
  lastError: null,
  rehearsal: false,
  measured: {},
  plan: null,

  receive: (s) => {
    const old = get();
    let measured = old.measured;
    if (old.rehearsal) {
      // An instance that vanished has finished (or was stopped): record how long it really played.
      const alive = new Set(s.running.map((r) => r.instance));
      for (const [inst, seen] of lastSeen) {
        if (!alive.has(inst)) {
          if (!seen.pad && seen.played > 1) measured = { ...measured, [seen.cueId]: Math.round(seen.played) };
          lastSeen.delete(inst);
        }
      }
      for (const r of s.running) {
        lastSeen.set(r.instance, { cueId: r.cueId, played: (r.pass - 1) * r.length + r.position, pad: !!r.padId });
      }
    }
    set({
      state: s,
      measured,
      log: s.newLog.length ? [...old.log, ...s.newLog.map((l) => ({ ...l, rehearsal: old.rehearsal }))].slice(-LOG_CAP) : old.log,
    });
  },
  setOutput: (output) => {
    if (output.outputFound && output.preferred) seenPreferred = output.preferred;
    const outputLost = !output.outputFound && !!output.preferred && output.preferred === seenPreferred;
    set({ output, outputLost });
  },
  setError: (lastError) => set({ lastError }),
  setRehearsal: (rehearsal) => {
    lastSeen.clear();
    set({ rehearsal });
  },
  adoptPlan: () => set((s) => ({ plan: { ...(s.plan ?? {}), ...s.measured } })),
  clearPlan: () => set({ plan: null }),
}));
