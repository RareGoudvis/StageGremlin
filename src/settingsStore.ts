// Per-machine settings (language, shortcuts, background lock default).
// Stored by the shell under `ui` (settings_get / settings_set); in the browser, in localStorage.
// The keymap lives here so every shortcut handler reads the same, rebindable keys.

import { create } from "zustand";
import type { Lang } from "./i18n";
import { call } from "./lib/tauri";

/** Every rebindable action, with its default key. */
export const ACTIONS = {
  go: { label: "GO", key: "Space", where: "Run" },
  stopAll: { label: "Stop all (twice = Panic)", key: "Escape", where: "Run" },
  stopCue: { label: "Stop the playing cue", key: "S", where: "Run" },
  under: { label: "Under / back up", key: "U", where: "Run" },
  releaseVamp: { label: "Release vamp", key: "V", where: "Run" },
  find: { label: "Find a cue", key: "Ctrl+K", where: "Run" },
  preview: { label: "Headphone preview", key: "H", where: "Build, Run" },
  modeBuild: { label: "Go to Build", key: "Ctrl+1", where: "Everywhere" },
  modePreflight: { label: "Go to Preflight", key: "Ctrl+2", where: "Everywhere" },
  modeRun: { label: "Go to Run", key: "Ctrl+3", where: "Everywhere" },
  save: { label: "Save", key: "Ctrl+S", where: "Build" },
  saveAs: { label: "Save as", key: "Ctrl+Shift+S", where: "Build" },
  open: { label: "Open a show", key: "Ctrl+O", where: "Build" },
  newShow: { label: "New show", key: "Ctrl+N", where: "Build" },
  importAudio: { label: "Import audio", key: "Ctrl+I", where: "Build" },
  youtube: { label: "Import from YouTube", key: "Ctrl+Shift+Y", where: "Build" },
  undo: { label: "Undo", key: "Ctrl+Z", where: "Build" },
  redo: { label: "Redo", key: "Ctrl+Y", where: "Build" },
  print: { label: "Print cue sheet", key: "Ctrl+P", where: "Everywhere" },
  bigMode: { label: "Big mode", key: "Ctrl+B", where: "Everywhere" },
  theme: { label: "Cycle theme", key: "Ctrl+T", where: "Everywhere" },
  redMode: { label: "Red night mode", key: "Ctrl+Shift+R", where: "Everywhere" },
} as const;

export type Action = keyof typeof ACTIONS;

export interface UiSettings {
  lang: Lang;
  /** Only the keys the operator changed; everything else uses ACTIONS[...].key. */
  keys: Partial<Record<Action, string>>;
  /** Whether the background player starts locked in Run (read by the background dock). */
  bgLockDefault: boolean;
}

const DEFAULTS: UiSettings = { lang: "en", keys: {}, bgLockDefault: false };

interface SettingsStore {
  ui: UiSettings;
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<UiSettings>) => void;
}

export const useSettings = create<SettingsStore>((set, get) => ({
  ui: DEFAULTS,
  loaded: false,
  load: async () => {
    try {
      const all = await call("settings_get");
      const ui = (all.ui ?? {}) as Partial<UiSettings>;
      set({ ui: { ...DEFAULTS, ...ui, keys: { ...(ui.keys ?? {}) } }, loaded: true });
    } catch (e) {
      console.warn("[cueplay] settings_get", e);
      set({ loaded: true });
    }
  },
  update: (patch) => {
    const ui = { ...get().ui, ...patch };
    set({ ui });
    call("settings_set", { patch: { ui } }).catch((e) => console.warn("[cueplay] settings_set", e));
  },
}));

// ---- keys ----

/** A key event as text, e.g. "Ctrl+Shift+K", "Space", "Escape", "H", "1". */
export function keyName(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  let k = e.key;
  if (k === " ") k = "Space";
  else if (/^Digit\d$/.test(e.code)) k = e.code.slice(5); // Ctrl+1 even on AZERTY keyboards
  else if (k.length === 1) k = k.toUpperCase();
  if (!["Control", "Shift", "Alt", "Meta"].includes(k)) parts.push(k);
  return parts.join("+");
}

export function keyFor(action: Action): string {
  return useSettings.getState().ui.keys[action] ?? ACTIONS[action].key;
}

/** Does this key event trigger `action` (with the operator's own keys)? */
export function isAction(e: KeyboardEvent, action: Action): boolean {
  return keyName(e) === keyFor(action);
}

/** Other actions that already use `key` (to warn about conflicts). */
export function conflictsFor(action: Action, key: string): Action[] {
  return (Object.keys(ACTIONS) as Action[]).filter((a) => a !== action && keyFor(a) === key);
}
