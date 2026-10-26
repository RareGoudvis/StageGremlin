// The editor's state: the show document, undo/redo, selection, mode and theme.
// Live engine state (30 updates a second) lives in engineStore.ts so it doesn't
// re-render the editor.

import { create } from "zustand";
import type { Cue, Loudness, Show } from "./types";
import { allCues, fillNumbers, newShow, renumber } from "./types";
import { rangeIds } from "./lib/showOps";

export type Mode = "build" | "preflight" | "run";
export type ThemePref = "auto" | "oled" | "light";
export type FileDisplay = "name" | "path";
/** What Build's left rail shows: the cue list, the pads grid or the media bin. */
export type BuildTab = "cues" | "pads" | "media";

/** Per-cue analysis progress. Not part of the document (not saved, not undoable). */
export type AnalysisStatus =
  | { state: "busy" }
  | { state: "converting" }
  /** `unsupported` = our decoder can't play this format (opus/webm): offer "Convert to M4A". */
  | { state: "error"; message: string; unsupported?: boolean };

const HISTORY_CAP = 100;
/** Edits with the same coalesce key this close together become one undo step (typing, dragging a slider). */
const COALESCE_MS = 1200;

export interface EditOpts {
  /** Edits with the same key in quick succession share one undo step. */
  coalesce?: string;
  /** Run is locked; only Make next passes this. */
  allowInRun?: boolean;
}

interface DocState {
  show: Show;
  /** The show as it was last saved/opened. dirty = show !== savedShow. */
  savedShow: Show;
  path: string | null;
  past: Show[];
  future: Show[];
  lastEdit: { key: string; at: number } | null;

  selection: string[];
  /** The cue the inspector shows: the one clicked last. */
  primary: string | null;

  mode: Mode;
  themePref: ThemePref;
  fileDisplay: FileDisplay;
  collapsed: Record<string, boolean>;
  analysis: Record<string, AnalysisStatus>;
  /** Preflight's manual tick boxes; reset when a show is opened. */
  manualChecks: Record<string, boolean>;
  buildTab: BuildTab;
  /** The pad the inspector shows when buildTab is "pads". */
  selectedPad: string | null;

  edit: (fn: (s: Show) => Show, opts?: EditOpts) => void;
  undo: () => void;
  redo: () => void;
  loadShow: (show: Show, path: string | null) => void;
  /** `sent` is the show we handed to show_save, to tell whether it changed while saving. */
  adoptSaved: (saved: Show, path: string, sent: Show) => void;
  mergeLoudness: (cueId: string, loudness: Loudness) => void;
  setAnalysis: (cueId: string, status: AnalysisStatus | null) => void;

  select: (id: string, how?: { ctrl?: boolean; shift?: boolean }) => void;
  setSelection: (ids: string[]) => void;

  setMode: (m: Mode) => void;
  cycleTheme: () => void;
  toggleFileDisplay: () => void;
  setCollapsed: (sectionId: string, collapsed: boolean) => void;
  setAllCollapsed: (collapsed: boolean) => void;
  setManualCheck: (key: string, on: boolean) => void;
  setBuildTab: (t: BuildTab) => void;
  selectPad: (padId: string | null) => void;
}

function loadThemePref(): ThemePref {
  try {
    const v = localStorage.getItem("cueplay.theme");
    if (v === "auto" || v === "oled" || v === "light") return v;
  } catch {
    // Storage blocked: fall back to auto.
  }
  return "auto";
}

/**
 * Apply `patch` to cue `id` in the current show AND in every undo/redo snapshot.
 * Used for facts about a file (loudness, saved path) that should survive undo.
 */
function patchEverywhere(s: Pick<DocState, "show" | "past" | "future">, id: string, patch: Partial<Cue>) {
  const fix = (show: Show): Show => {
    if (allCues(show).some((c) => c.id === id)) {
      return { ...show, sections: show.sections.map((sec) => ({ ...sec, cues: sec.cues.map((c) => (c.id === id ? { ...c, ...patch } : c)) })) };
    }
    // Pads carry their own cue.
    if (show.pads?.some((p) => p.cue.id === id)) {
      return { ...show, pads: show.pads.map((p) => (p.cue.id === id ? { ...p, cue: { ...p.cue, ...patch } } : p)) };
    }
    return show;
  };
  return { show: fix(s.show), past: s.past.map(fix), future: s.future.map(fix) };
}

const initial = renumber(newShow());

export const useDoc = create<DocState>((set, get) => ({
  show: initial,
  savedShow: initial,
  path: null,
  past: [],
  future: [],
  lastEdit: null,
  selection: [],
  primary: null,
  mode: "build",
  themePref: loadThemePref(),
  fileDisplay: "name",
  collapsed: {},
  analysis: {},
  manualChecks: {},
  buildTab: "cues",
  selectedPad: null,

  edit: (fn, opts = {}) => {
    const s = get();
    const coalesceKey = opts.coalesce;
    if (s.mode === "run" && !opts.allowInRun) {
      // Run is locked. The only document change allowed there is Make next.
      console.warn("[cueplay] edit ignored: Run mode is locked");
      return;
    }
    // Numbers are the operator's: only new (empty) numbers are filled in. "Renumber all" is explicit.
    const next = fillNumbers(fn(s.show));
    if (next === s.show) return;
    const now = Date.now();
    const merge = !!coalesceKey && s.lastEdit?.key === coalesceKey && now - s.lastEdit.at < COALESCE_MS;
    set({
      show: next,
      past: merge ? s.past : [...s.past, s.show].slice(-HISTORY_CAP),
      future: [],
      lastEdit: coalesceKey ? { key: coalesceKey, at: now } : null,
    });
  },

  undo: () => {
    const s = get();
    if (s.mode === "run" || !s.past.length) return;
    set({ show: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s.show, ...s.future], lastEdit: null });
  },

  redo: () => {
    const s = get();
    if (s.mode === "run" || !s.future.length) return;
    set({ show: s.future[0], future: s.future.slice(1), past: [...s.past, s.show], lastEdit: null });
  },

  loadShow: (show, path) => {
    // Older show files have no pads list yet.
    const clean = fillNumbers({ ...show, pads: show.pads ?? [] });
    set({ show: clean, savedShow: clean, path, past: [], future: [], lastEdit: null, selection: [], primary: null, selectedPad: null, analysis: {}, collapsed: {}, manualChecks: {} });
  },

  // After show_save the engine returns the show with files rewritten to media/…
  // We copy those paths into the history too, so undo never points at the old location.
  adoptSaved: (saved, path, sent) => {
    const s = get();
    let patched: Pick<DocState, "show" | "past" | "future"> = { show: s.show, past: s.past, future: s.future };
    for (const c of [...allCues(saved), ...(saved.pads ?? []).map((p) => p.cue)]) {
      patched = patchEverywhere(patched, c.id, { file: c.file, swappedFrom: c.swappedFrom });
    }
    const clean = fillNumbers({ ...saved, pads: saved.pads ?? [] });
    if (s.show === sent) {
      // Nothing changed while saving: the saved show is the current one.
      set({ ...patched, show: clean, savedShow: clean, path });
    } else {
      // Edited during the save: keep those edits (with fixed paths) and stay dirty.
      set({ ...patched, savedShow: clean, path });
    }
  },

  mergeLoudness: (cueId, loudness) => set((s) => patchEverywhere(s, cueId, { loudness })),

  setAnalysis: (cueId, status) =>
    set((s) => {
      const analysis = { ...s.analysis };
      if (status) analysis[cueId] = status;
      else delete analysis[cueId];
      return { analysis };
    }),

  select: (id, how = {}) => {
    const s = get();
    if (how.shift && s.primary) {
      set({ selection: rangeIds(s.show, s.primary, id), primary: id });
    } else if (how.ctrl) {
      const has = s.selection.includes(id);
      const selection = has ? s.selection.filter((x) => x !== id) : [...s.selection, id];
      set({ selection, primary: has ? selection[selection.length - 1] ?? null : id });
    } else {
      set({ selection: [id], primary: id });
    }
  },

  setSelection: (ids) => set({ selection: ids, primary: ids[ids.length - 1] ?? null }),

  setMode: (mode) => set({ mode }),

  cycleTheme: () => {
    const order: ThemePref[] = ["auto", "oled", "light"];
    const themePref = order[(order.indexOf(get().themePref) + 1) % order.length];
    try {
      localStorage.setItem("cueplay.theme", themePref);
    } catch {
      // Not saved; the choice still applies until the app closes.
    }
    set({ themePref });
  },

  toggleFileDisplay: () => set((s) => ({ fileDisplay: s.fileDisplay === "name" ? "path" : "name" })),
  setCollapsed: (id, collapsed) => set((s) => ({ collapsed: { ...s.collapsed, [id]: collapsed } })),
  setAllCollapsed: (collapsed) =>
    set((s) => ({ collapsed: Object.fromEntries(s.show.sections.map((sec) => [sec.id, collapsed])) })),
  setManualCheck: (key, on) => set((s) => ({ manualChecks: { ...s.manualChecks, [key]: on } })),
  setBuildTab: (buildTab) => set({ buildTab }),
  selectPad: (selectedPad) => set({ selectedPad }),
}));

/** True when the show has changes that are not saved yet. */
export const useDirty = () => useDoc((s) => s.show !== s.savedShow);

/** The theme actually shown: auto = light while editing, OLED black in Run. */
export function effectiveTheme(pref: ThemePref, mode: Mode): "oled" | "light" {
  if (pref !== "auto") return pref;
  return mode === "run" ? "oled" : "light";
}
