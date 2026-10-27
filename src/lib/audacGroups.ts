// Pure helpers for AUDAC groups, the guard and the "changed by someone else" messages.
// Kept apart from the panel so they can be tested.

import type { AudacChange, AudacZone } from "./audac";

/** How a set of zones looks together: one volume (the loudest), muted only when all are, an input when all share it. */
export function summarize(zones: AudacZone[], members: number[]): { volume: number; mute: boolean; input: number } {
  const list = members.map((n) => zones[n - 1]).filter(Boolean);
  if (!list.length) return { volume: 70, mute: false, input: 0 };
  const input = list.every((z) => z.input === list[0].input) ? list[0].input : 0;
  return { volume: Math.min(...list.map((z) => z.volume)), mute: list.every((z) => z.mute), input };
}

/** Which zones to guard right now. */
export function activeGuard(guard: { zones: number[]; when: "off" | "run" | "always" }, inRun: boolean): number[] {
  if (guard.when === "always" || (guard.when === "run" && inRun)) return [...guard.zones].sort((a, b) => a - b);
  return [];
}

/** "09:31 · Podium: input Line 3 → Aux (put back)" in the operator's words. */
export function describeChange(
  c: AudacChange,
  zoneName: (n: number) => string,
  inputName: (n: number) => string,
  words: { volume: string; input: string; mute: string; on: string; off: string; putBack: string },
): string {
  const time = new Date(c.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const value = (v: number) =>
    c.what === "input" ? (v ? inputName(v) : "—") : c.what === "mute" ? (v ? words.on : words.off) : v >= 70 ? "off" : `−${v} dB`;
  const what = c.what === "input" ? words.input : c.what === "mute" ? words.mute : words.volume;
  return `${time} · ${zoneName(c.zone)}: ${what} ${value(c.from)} → ${value(c.to)}${c.restored ? ` (${words.putBack})` : ""}`;
}
