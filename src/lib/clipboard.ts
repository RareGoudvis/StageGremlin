// Cut / Copy / Paste / Duplicate for cues (Ctrl+X / C / V / D in Build).
// An internal clipboard: copies get fresh ids, and cues attached to a parent that was copied
// along stay attached to the new copy of that parent. Pasted cues get new numbers.

import { useDoc } from "../store";
import { toast } from "../uiStore";
import type { Cue } from "../types";
import { allCues, newId } from "../types";
import { insertCues, locate, removeCues } from "./showOps";

let clip: Cue[] = [];

/** The selected cues in show order. */
function selectedCues(): Cue[] {
  const { show, selection } = useDoc.getState();
  const set = new Set(selection);
  return allCues(show).filter((c) => set.has(c.id));
}

/** Fresh copies: new ids, empty numbers (filled in on insert), attach links remapped inside the group. */
function cloneGroup(cues: Cue[]): Cue[] {
  const idMap = new Map(cues.map((c) => [c.id, newId()]));
  return cues.map((c) => ({
    ...structuredClone(c),
    id: idMap.get(c.id)!,
    number: "",
    attach: c.attach ? { ...c.attach, to: idMap.get(c.attach.to) ?? c.attach.to } : null,
  }));
}

export function copyCues() {
  clip = selectedCues().map((c) => structuredClone(c));
  if (clip.length) toast(`Copied ${clip.length} cue${clip.length > 1 ? "s" : ""}`);
}

export function cutCues() {
  copyCues();
  if (!clip.length) return;
  const ids = clip.map((c) => c.id);
  useDoc.getState().edit((s) => removeCues(s, ids));
  useDoc.getState().setSelection([]);
}

/** Paste after the last selected cue (or at the end of the show). */
export function pasteCues() {
  if (!clip.length) return toast("Nothing copied yet");
  insertAfterSelection(cloneGroup(clip));
}

export function duplicateCues() {
  const cues = selectedCues();
  if (!cues.length) return;
  insertAfterSelection(cloneGroup(cues));
}

function insertAfterSelection(copies: Cue[]) {
  const { show, selection } = useDoc.getState();
  const order = allCues(show).map((c) => c.id);
  const after = [...selection].sort((a, b) => order.indexOf(a) - order.indexOf(b)).pop() ?? null;
  useDoc.getState().edit((s) => insertCues(s, copies, after && locate(s, after) ? after : null));
  useDoc.getState().setSelection(copies.map((c) => c.id));
}
