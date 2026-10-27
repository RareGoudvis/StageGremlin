// Small pure decisions with no app state, kept apart so they can be unit-tested (npm test).

export const DOUBLE_PRESS_MS = 500;

export type EmergencyAction = "stopAll" | "panic" | "closeOverlay";

/**
 * What one press of the Stop-all key does in Run / Dumbo mode (see emergencyKeys.ts):
 * a second press within 500 ms is Panic, always; Esc with a dialog/menu open only closes it;
 * otherwise Stop all.
 */
export function decideStopKey(p: { now: number; lastPress: number; overlayOpen: boolean; isEscape: boolean }): {
  action: EmergencyAction;
  lastPress: number;
} {
  if (p.lastPress > 0 && p.now - p.lastPress < DOUBLE_PRESS_MS) return { action: "panic", lastPress: 0 };
  if (p.overlayOpen && p.isEscape) return { action: "closeOverlay", lastPress: p.now };
  return { action: "stopAll", lastPress: p.now };
}

/** Same-device test, tolerant of how Windows names one device in different lists. */
export function sameDevice(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  return x === y || x.includes(y) || y.includes(x);
}
