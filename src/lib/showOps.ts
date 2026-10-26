// Pure functions that take a Show and return a changed copy. The store wraps them
// with undo/redo; keeping them here (without React or Zustand) makes them easy to read and test.

import type { Cue, Pad, PadMode, Section, Show } from "../types";
import { allCues, newSection } from "../types";

export interface CueLocation { cue: Cue; section: Section; sectionIndex: number; index: number }

export function locate(show: Show, id: string): CueLocation | null {
  for (let si = 0; si < show.sections.length; si++) {
    const s = show.sections[si];
    const i = s.cues.findIndex((c) => c.id === id);
    if (i >= 0) return { cue: s.cues[i], section: s, sectionIndex: si, index: i };
  }
  return null;
}

export function findCue(show: Show, id: string | null | undefined): Cue | null {
  if (!id) return null;
  return locate(show, id)?.cue ?? null;
}

/** Change one cue. `patch` may be an object or a function of the old cue. */
export function updateCue(show: Show, id: string, patch: Partial<Cue> | ((c: Cue) => Partial<Cue>)): Show {
  return {
    ...show,
    sections: show.sections.map((s) =>
      s.cues.some((c) => c.id === id)
        ? { ...s, cues: s.cues.map((c) => (c.id === id ? { ...c, ...(typeof patch === "function" ? patch(c) : patch) } : c)) }
        : s,
    ),
  };
}

/** Insert new cues after `afterId`; without it, at the end of `sectionId` (or the last section). */
export function insertCues(show: Show, cues: Cue[], afterId: string | null, sectionId?: string): Show {
  let sections = show.sections.length ? show.sections : [newSection("Opening")];
  const at = afterId ? locate({ ...show, sections }, afterId) : null;
  const si = at ? at.sectionIndex : Math.max(0, sections.findIndex((s) => s.id === sectionId));
  const targetIndex = sectionId || at ? si : sections.length - 1;
  sections = sections.map((s, i) => {
    if (i !== targetIndex) return s;
    const pos = at ? at.index + 1 : s.cues.length;
    return { ...s, cues: [...s.cues.slice(0, pos), ...cues, ...s.cues.slice(pos)] };
  });
  return { ...show, sections };
}

/** Delete cues. Cues that were attached to a deleted cue become normal GO cues again. */
export function removeCues(show: Show, ids: string[]): Show {
  const gone = new Set(ids);
  return {
    ...show,
    sections: show.sections.map((s) => ({
      ...s,
      cues: s.cues
        .filter((c) => !gone.has(c.id))
        .map((c) => (c.attach && gone.has(c.attach.to) ? { ...c, attach: null } : c)),
    })),
  };
}

/** Take cues out of the show (in show order) without touching attach links. */
function takeOut(show: Show, ids: string[]): { show: Show; taken: Cue[] } {
  const set = new Set(ids);
  const taken = allCues(show).filter((c) => set.has(c.id));
  return {
    taken,
    show: { ...show, sections: show.sections.map((s) => ({ ...s, cues: s.cues.filter((c) => !set.has(c.id)) })) },
  };
}

/**
 * Move cues so they sit in `sectionId` just before `beforeId` (or at the end of the section
 * when `beforeId` is null). Used by drag & drop and by Make next.
 */
export function moveCues(show: Show, ids: string[], sectionId: string, beforeId: string | null): Show {
  if (beforeId && ids.includes(beforeId)) return show;
  const { show: rest, taken } = takeOut(show, ids);
  if (!taken.length) return show;
  return {
    ...rest,
    sections: rest.sections.map((s) => {
      if (s.id !== sectionId) return s;
      const pos = beforeId ? s.cues.findIndex((c) => c.id === beforeId) : -1;
      const at = pos >= 0 ? pos : s.cues.length;
      return { ...s, cues: [...s.cues.slice(0, at), ...taken, ...s.cues.slice(at)] };
    }),
  };
}

/** Make next: put `id` directly in front of `beforeId`, wherever that is. */
export function moveBefore(show: Show, id: string, beforeId: string): Show {
  const target = locate(show, beforeId);
  if (!target || id === beforeId) return show;
  return moveCues(show, [id], target.section.id, beforeId);
}

/**
 * Alt+↑ / Alt+↓: move the selected cues one step. At the top of a section they hop
 * to the end of the section above (and the other way round going down).
 */
export function moveBy(show: Show, ids: string[], dir: -1 | 1): Show {
  const set = new Set(ids);
  // A flat list of "tokens": a section start, then its cues.
  type Tok = { kind: "sec"; si: number } | { kind: "cue"; si: number; id: string };
  const toks: Tok[] = [];
  show.sections.forEach((s, si) => {
    toks.push({ kind: "sec", si });
    s.cues.forEach((c) => toks.push({ kind: "cue", si, id: c.id }));
  });
  const selIdx = toks.flatMap((t, i) => (t.kind === "cue" && set.has(t.id) ? [i] : []));
  if (!selIdx.length) return show;

  if (dir === -1) {
    // Look at what sits just above the first selected cue.
    let j = selIdx[0] - 1;
    while (j >= 0 && toks[j].kind === "cue" && set.has((toks[j] as { id: string }).id)) j--;
    const above = toks[j];
    if (!above) return show;
    if (above.kind === "cue") return moveCues(show, ids, show.sections[above.si].id, above.id);
    // We are at the top of a section: go to the end of the previous one.
    if (above.si === 0) return show;
    return moveCues(show, ids, show.sections[above.si - 1].id, null);
  }
  let j = selIdx[selIdx.length - 1] + 1;
  while (j < toks.length && toks[j].kind === "cue" && set.has((toks[j] as { id: string }).id)) j++;
  const below = toks[j];
  if (!below) return show;
  if (below.kind === "cue") {
    // Insert after `below`: that is before whatever follows it in the same section.
    const s = show.sections[below.si];
    const k = s.cues.findIndex((c) => c.id === below.id);
    const after = s.cues.slice(k + 1).find((c) => !set.has(c.id));
    return moveCues(show, ids, s.id, after?.id ?? null);
  }
  // Next token is a section header: go to the top of that section.
  const s = show.sections[below.si];
  return moveCues(show, ids, s.id, s.cues.find((c) => !set.has(c.id))?.id ?? null);
}

// ---- sections ----

export function addSection(show: Show, name: string, afterId?: string | null): Show {
  const sec = newSection(name);
  const i = afterId ? show.sections.findIndex((s) => s.id === afterId) : -1;
  const at = i >= 0 ? i + 1 : show.sections.length;
  return { ...show, sections: [...show.sections.slice(0, at), sec, ...show.sections.slice(at)] };
}

export function renameSection(show: Show, id: string, name: string): Show {
  return { ...show, sections: show.sections.map((s) => (s.id === id ? { ...s, name } : s)) };
}

export function deleteSection(show: Show, id: string): Show {
  const sec = show.sections.find((s) => s.id === id);
  if (!sec) return show;
  const withoutCues = removeCues(show, sec.cues.map((c) => c.id));
  return { ...withoutCues, sections: withoutCues.sections.filter((s) => s.id !== id) };
}

/** Ids of every cue between `a` and `b` (inclusive) in show order, for Shift+click. */
export function rangeIds(show: Show, a: string, b: string): string[] {
  const list = allCues(show).map((c) => c.id);
  const i = list.indexOf(a);
  const j = list.indexOf(b);
  if (i < 0 || j < 0) return [b];
  return list.slice(Math.min(i, j), Math.max(i, j) + 1);
}

// ---- pads (soundboard) ----
// A pad wraps a Cue, so the same inspector, analysis and preview code works for both.

/** Find a cue by id in the sections OR inside a pad. */
export function findAnyCue(show: Show, id: string | null | undefined): Cue | null {
  if (!id) return null;
  return findCue(show, id) ?? show.pads.find((p) => p.cue.id === id)?.cue ?? null;
}

/** The pad that owns cue `cueId`, if it is a pad's cue. */
export function padOfCue(show: Show, cueId: string): Pad | null {
  return show.pads.find((p) => p.cue.id === cueId) ?? null;
}

/** Like updateCue, but also finds pad cues. */
export function updateAnyCue(show: Show, id: string, patch: Partial<Cue> | ((c: Cue) => Partial<Cue>)): Show {
  if (locate(show, id)) return updateCue(show, id, patch);
  return {
    ...show,
    pads: show.pads.map((p) =>
      p.cue.id === id ? { ...p, cue: { ...p.cue, ...(typeof patch === "function" ? patch(p.cue) : patch) } } : p,
    ),
  };
}

export function updatePad(show: Show, padId: string, patch: Partial<Omit<Pad, "cue">>): Show {
  return { ...show, pads: show.pads.map((p) => (p.id === padId ? { ...p, ...patch } : p)) };
}

export function addPads(show: Show, pads: Pad[]): Show {
  return { ...show, pads: [...show.pads, ...pads] };
}

export function removePad(show: Show, padId: string): Show {
  return { ...show, pads: show.pads.filter((p) => p.id !== padId) };
}

export const PAD_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

/** The first hotkey (1–9, 0) no pad uses yet, or "" when all ten are taken. */
export function freePadKey(show: Show, alsoTaken: string[] = []): string {
  const used = new Set([...show.pads.map((p) => p.hotkey), ...alsoTaken]);
  return PAD_KEYS.find((k) => !used.has(k)) ?? "";
}

export const PAD_MODES: { value: PadMode; label: string; hint: string }[] = [
  { value: "oneShot", label: "One-shot", hint: "Plays once; pressing again starts it again" },
  { value: "toggle", label: "Toggle", hint: "First press plays, second press stops" },
  { value: "loop", label: "Loop", hint: "Loops until pressed again" },
];
