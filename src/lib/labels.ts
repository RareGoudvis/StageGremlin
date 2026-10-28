// Translated names for the fixed lists in presets.ts and showOps.ts (EQ / compressor presets,
// cue colours, pad modes). Those lists keep their English names as ids (presets are matched by
// name), so we only swap the text at the moment it is shown. Unknown names show as they are.

import type { TKey, TVars } from "../i18n";

/** t() from useT() in a component, or tr() outside one. */
type T = (key: TKey, vars?: TVars) => string;

const EQ_NAMES: Record<string, [TKey, TKey]> = {
  "Flat": ["b.eqp.flat", "b.eqp.flatTip"],
  "Clear up a rip": ["b.eqp.rip", "b.eqp.ripTip"],
  "Less boomy": ["b.eqp.boomy", "b.eqp.boomyTip"],
  "Less harsh": ["b.eqp.harsh", "b.eqp.harshTip"],
  "Dance punch": ["b.eqp.dance", "b.eqp.danceTip"],
  "Voice": ["b.eqp.voice", "b.eqp.voiceTip"],
};
const COMP_NAMES: Record<string, TKey> = { Light: "b.cp.light", Medium: "b.cp.medium", Firm: "b.cp.firm" };
const COLOUR_NAMES: Record<string, TKey> = { Blue: "b.col.blue", Lime: "b.col.lime", Amber: "b.col.amber", Coral: "b.col.coral", Lilac: "b.col.lilac" };
const PAD_MODE_NAMES: Record<string, TKey> = { oneShot: "b.padMode.oneShot", toggle: "b.padMode.toggle", loop: "b.loop" };

export function eqPresetName(t: T, name: string): string {
  const k = EQ_NAMES[name];
  return k ? t(k[0]) : name;
}

export function eqPresetTip(t: T, name: string, tip: string): string {
  const k = EQ_NAMES[name];
  return k ? t(k[1]) : tip;
}

export function compPresetName(t: T, name: string): string {
  const k = COMP_NAMES[name];
  return k ? t(k) : name;
}

export function colourName(t: T, name: string): string {
  const k = COLOUR_NAMES[name];
  return k ? t(k) : name;
}

/** `value` is the pad mode ("oneShot", "toggle", "loop"); `label` is the English fallback. */
export function padModeLabel(t: T, value: string, label: string): string {
  const k = PAD_MODE_NAMES[value];
  return k ? t(k) : label;
}
