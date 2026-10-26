// Ready-made settings for the inspector. Values are deliberately gentle: these are
// "make it better" buttons for a teacher at a school show, not mastering tools.
// Band order matches defaultEq(): 100 Hz low shelf, 500 Hz, 2.5 kHz, 8 kHz high shelf.

import type { Compressor } from "../types";

export interface EqPreset {
  name: string;
  tip: string;
  gains: [number, number, number, number];
  /** High-pass to switch on with the preset; undefined = leave the high-pass as it is. */
  hpf?: number | null;
}

export const EQ_PRESETS: EqPreset[] = [
  { name: "Flat", tip: "No EQ.", gains: [0, 0, 0, 0] },
  { name: "Clear up a rip", tip: "Muddy YouTube rip: less mud, a little more presence and air.", gains: [-1, -3, 2, 2], hpf: 60 },
  { name: "Less boomy", tip: "Too much bass in a small hall.", gains: [-5, -1, 0, 0], hpf: 80 },
  { name: "Less harsh", tip: "Shouty or fizzy on the big speakers.", gains: [0, 0, -3, -2] },
  { name: "Dance punch", tip: "More kick and sparkle for a dance number.", gains: [3, -1, 1, 2] },
  { name: "Voice", tip: "Spoken word / announcements: thin out the lows, lift clarity.", gains: [-4, 0, 3, 0], hpf: 120 },
];

/** Which preset the cue's EQ matches right now (null = custom). */
export function matchEqPreset(gains: number[]): EqPreset | null {
  return EQ_PRESETS.find((p) => p.gains.every((g, i) => Math.abs(g - gains[i]) < 0.05)) ?? null;
}

export const COMP_PRESETS: { name: string; comp: Omit<Compressor, "on"> }[] = [
  { name: "Light", comp: { thresholdDb: -18, ratio: 2, attackMs: 10, releaseMs: 150, makeupDb: 0 } },
  { name: "Medium", comp: { thresholdDb: -20, ratio: 3, attackMs: 8, releaseMs: 120, makeupDb: 0 } },
  { name: "Firm", comp: { thresholdDb: -22, ratio: 4, attackMs: 5, releaseMs: 100, makeupDb: 0 } },
];

export function matchCompPreset(c: Compressor): string | null {
  return COMP_PRESETS.find((p) => p.comp.thresholdDb === c.thresholdDb && p.comp.ratio === c.ratio)?.name ?? null;
}

/** The five cue colours from the design, plus "none". */
export const CUE_COLORS = [
  { value: "#7FB2FF", name: "Blue" },
  { value: "#C6F432", name: "Lime" },
  { value: "#FFB224", name: "Amber" },
  { value: "#FF7A6B", name: "Coral" },
  { value: "#C9A2FF", name: "Lilac" },
];
