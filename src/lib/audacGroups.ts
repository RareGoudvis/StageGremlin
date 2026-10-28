// Pure helpers for AUDAC groups, the guard and the "changed by someone else" messages.
// Kept apart from the panel so they can be tested.

import type { AudacChange, AudacZone } from "./audac";
import type { ScheduleEntry } from "../settingsStore";

/** How one zone is protected (mirrors src-tauri/src/audac/watch.rs, Rule). */
export interface GuardRule {
  zone: number;
  /** Put back every change. */
  full: boolean;
  /** Never louder than this (dB below max). */
  ceiling: number | null;
  /** No limit on putting back. */
  unlimited: boolean;
}

/** A scheduled time's level for one zone (its own, in the advanced view, or the shared one). */
export function volumeFor(e: Pick<ScheduleEntry, "volume" | "zoneVolumes">, zone: number): number {
  return e.zoneVolumes?.[String(zone)] ?? e.volume;
}

/** How a set of zones looks together: one volume (the loudest), muted only when all are, an input when all share it. */
export function summarize(zones: AudacZone[], members: number[]): { volume: number; mute: boolean; input: number } {
  const list = members.map((n) => zones[n - 1]).filter(Boolean);
  if (!list.length) return { volume: 70, mute: false, input: 0 };
  const input = list.every((z) => z.input === list[0].input) ? list[0].input : 0;
  return { volume: Math.min(...list.map((z) => z.volume)), mute: list.every((z) => z.mute), input };
}

/** Which zones to guard right now (Settings › AUDAC › Guard). */
export function activeGuard(guard: { zones: number[]; when: "off" | "run" | "always" }, inRun: boolean): number[] {
  if (guard.when === "always" || (guard.when === "run" && inRun)) return [...guard.zones].sort((a, b) => a - b);
  return [];
}

/**
 * Everything that protects zones right now, merged per zone: the Guard setting (polite or Hold)
 * and every scheduled time that is on. The strictest wins: any "full" makes it full, the quietest
 * ceiling counts, and a ceiling is always put back without limit (hearing safety).
 */
export function guardRules(
  guard: { zones: number[]; when: "off" | "run" | "always"; strength?: "polite" | "hold" },
  inRun: boolean,
  running: Pick<ScheduleEntry, "zones" | "volume" | "zoneVolumes" | "protect">[],
): GuardRule[] {
  const rules = new Map<number, GuardRule>();
  const add = (zone: number, r: Omit<GuardRule, "zone">) => {
    const old = rules.get(zone);
    rules.set(zone, old ? {
      zone,
      full: old.full || r.full,
      ceiling: old.ceiling === null ? r.ceiling : r.ceiling === null ? old.ceiling : Math.max(old.ceiling, r.ceiling),
      unlimited: old.unlimited || r.unlimited,
    } : { zone, ...r });
  };
  for (const z of activeGuard(guard, inRun)) add(z, { full: true, ceiling: null, unlimited: guard.strength === "hold" });
  for (const e of running) {
    const how = e.protect ?? "noLouder";
    if (how === "off") continue;
    for (const z of e.zones) add(z, { full: how === "full", ceiling: volumeFor(e, z), unlimited: true });
  }
  return [...rules.values()].sort((a, b) => a.zone - b.zone);
}

/** "09:31 · Podium: input Line 3 → Aux (put back)" in the operator's words. */
export function describeChange(
  c: AudacChange,
  zoneName: (n: number) => string,
  inputName: (n: number) => string,
  // volOff: a volume at the bottom of the range ("off"; left out = English).
  words: { volume: string; input: string; mute: string; on: string; off: string; putBack: string; volOff?: string },
): string {
  const time = new Date(c.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const value = (v: number) =>
    c.what === "input" ? (v ? inputName(v) : "—") : c.what === "mute" ? (v ? words.on : words.off) : v >= 70 ? (words.volOff ?? "off") : `−${v} dB`;
  const what = c.what === "input" ? words.input : c.what === "mute" ? words.mute : words.volume;
  return `${time} · ${zoneName(c.zone)}: ${what} ${value(c.from)} → ${value(c.to)}${c.restored ? ` (${words.putBack})` : ""}`;
}
