// Per-machine settings (language, shortcuts, background lock default).
// Stored by the shell under `ui` (settings_get / settings_set); in the browser, in localStorage.
// The keymap lives here so every shortcut handler reads the same, rebindable keys.

import { create } from "zustand";
import type { Lang } from "./i18n";
import { call } from "./lib/tauri";

/** Every rebindable action, with its default key. */
export const ACTIONS = {
  go: { label: "GO", key: "Space", where: "Run" },
  goAlt: { label: "GO (second key)", key: "Enter", where: "Run" },
  stopAll: { label: "Stop all (twice = Panic)", key: "Escape", where: "Run" },
  stopCue: { label: "Stop the playing cue", key: "S", where: "Run" },
  under: { label: "Under / back up", key: "U", where: "Run" },
  releaseVamp: { label: "Release vamp", key: "V", where: "Run" },
  find: { label: "Find a cue", key: "Ctrl+K", where: "Build, Run" },
  preview: { label: "Headphone preview", key: "H", where: "Build, Run" },
  modeBuild: { label: "Go to Build", key: "Ctrl+1", where: "Everywhere" },
  modePreflight: { label: "Go to Preflight", key: "Ctrl+2", where: "Everywhere" },
  modeRun: { label: "Go to Run", key: "Ctrl+3", where: "Everywhere" },
  modeBackground: { label: "Go to Background", key: "Ctrl+4", where: "Everywhere" },
  save: { label: "Save", key: "Ctrl+S", where: "Build" },
  saveAs: { label: "Save as", key: "Ctrl+Shift+S", where: "Build" },
  open: { label: "Open a show", key: "Ctrl+O", where: "Build" },
  newShow: { label: "New show", key: "Ctrl+N", where: "Build" },
  importAudio: { label: "Add window (audio files)", key: "Ctrl+I", where: "Build" },
  youtube: { label: "Add window (YouTube & lists)", key: "Ctrl+Shift+Y", where: "Build" },
  undo: { label: "Undo", key: "Ctrl+Z", where: "Build" },
  redo: { label: "Redo", key: "Ctrl+Y", where: "Build" },
  print: { label: "Print cue sheet", key: "Ctrl+P", where: "Everywhere" },
  bigMode: { label: "Big mode", key: "Ctrl+B", where: "Everywhere" },
  theme: { label: "Cycle theme", key: "Ctrl+T", where: "Everywhere" },
  redMode: { label: "Red night mode", key: "Ctrl+Shift+R", where: "Everywhere" },
  pauseAll: { label: "Pause / resume everything", key: "P", where: "Run" },
  bgDuck: { label: "Background: duck (Alt = no fade)", key: "D", where: "Run" },
  bgRestore: { label: "Background: restore (Alt = no fade)", key: "R", where: "Run" },
  bgPlayPause: { label: "Background: play / pause", key: "Shift+D", where: "Run" },
  bgNext: { label: "Background: next track", key: "Shift+ArrowRight", where: "Run" },
  settings: { label: "Open settings", key: "Ctrl+,", where: "Build, Preflight" },
  cut: { label: "Cut cues", key: "Ctrl+X", where: "Build" },
  copy: { label: "Copy cues", key: "Ctrl+C", where: "Build" },
  paste: { label: "Paste cues", key: "Ctrl+V", where: "Build" },
  duplicate: { label: "Duplicate cues", key: "Ctrl+D", where: "Build" },
} as const;

export type Action = keyof typeof ACTIONS;

export interface UiSettings {
  lang: Lang;
  /** Only the keys the operator changed; everything else uses ACTIONS[...].key. */
  keys: Partial<Record<Action, string>>;
  /** Whether the background player starts locked in Run (read by the background dock). */
  bgLockDefault: boolean;
  /** UI size in percent (90–130), applied as CSS zoom on the app. */
  zoom: number;
  /** Dumbo mode: a super-simple Run screen for an inexperienced operator. */
  dumbo: boolean;
  /** Show a row of pad buttons in Dumbo mode. */
  dumboPads: boolean;
  /** Optional 4-digit PIN to leave Dumbo mode (empty = hold the corner button 3 s). */
  dumboPin: string;
  /** Default YouTube download format. */
  ytFormat: "original" | "mp3" | "wav";
  /** Shows opened or saved on this laptop, newest first (File › Open recent). */
  recent: string[];
  /** The school's AUDAC MTX88 (Settings › AUDAC). Empty host = not set up. */
  audac: AudacSetup;
  /** "salt:sha256" of the admin password (see lib/admin.ts). Empty = none set yet: admin settings stay locked. */
  adminHash: string;
}

/** Names and visibility of the MTX's 8 zones and 8 inputs, plus how to reach it. */
export interface AudacSetup {
  host: string;
  port: number;
  /** Connect (and hold the connection) as soon as the app starts. */
  autoConnect: boolean;
  /** Demo: a pretend MTX inside the app (no box, no network), for showing or trying the AUDAC controls. */
  demo: boolean;
  /** The AUDAC tab in Run's dock: shown, shown but locked against mis-taps, or not there at all. */
  inRun: "show" | "locked" | "hide";
  zones: { name: string; show: boolean }[];
  inputs: { name: string; show: boolean }[];
  /** Times when StageGremlin sets zones (and starts background music) by itself, e.g. lunch. */
  schedule: ScheduleEntry[];
  /** Don't start scheduled times while a show is running (Run). */
  schedulePauseInRun: boolean;
  /** When a scheduled time ends: let the MTX go (Touch 2 can connect) or keep holding it. */
  scheduleAfter: "release" | "keep";
}

export interface ScheduleEntry {
  id: string;
  name: string;
  on: boolean;
  /** 0 = Sunday … 6 = Saturday (like JavaScript's getDay). */
  days: number[];
  /** "HH:MM", 24-hour, local time. `to` is later than `from` on the same day. */
  from: string;
  to: string;
  /** Zones (1–8) switched to `input` (1–8) at `volume` dB below max, unmuted; muted again at the end. */
  zones: number[];
  input: number;
  volume: number;
  /** Optional: background music to start ("" = none) and a playlist link on that service. */
  music: { source: "" | "spotify" | "ytmusic" | "beatport" | "soundtrack"; link: string };
}

// Names from AUDAC's MTX input list; each school renames them (aux, streambox, mic…) and hides the unused.
const AUDAC_DEFAULT: AudacSetup = {
  host: "",
  port: 5001,
  autoConnect: true,
  demo: false,
  inRun: "show",
  zones: Array.from({ length: 8 }, (_, i) => ({ name: `Zone ${i + 1}`, show: true })),
  inputs: ["Mic 1", "Mic 2", "Line 3", "Line 4", "Line 5", "Line 6", "WLI/MWX65", "WMI"].map((name) => ({ name, show: true })),
  schedule: [],
  schedulePauseInRun: true,
  scheduleAfter: "release",
};

const DEFAULTS: UiSettings = { lang: "en", keys: {}, bgLockDefault: false, zoom: 100, dumbo: false, dumboPads: false, dumboPin: "", ytFormat: "original", recent: [], audac: AUDAC_DEFAULT, adminHash: "" };

/** Put a show file at the top of the recent list (max 8, no doubles). */
export function rememberRecent(path: string) {
  const s = useSettings.getState();
  const same = (a: string) => a.toLowerCase() === path.toLowerCase(); // Windows paths ignore case
  s.update({ recent: [path, ...s.ui.recent.filter((p) => !same(p))].slice(0, 8) });
}

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
      set({ ui: { ...DEFAULTS, ...ui, keys: { ...(ui.keys ?? {}) }, audac: { ...AUDAC_DEFAULT, ...(ui.audac ?? {}) } }, loaded: true });
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

/**
 * Does this key event trigger `action` (with the operator's own keys)?
 * `ignoreAlt`: Alt is a variant of the same action (background keys: Alt = without fade).
 */
export function isAction(e: KeyboardEvent, action: Action, opts: { ignoreAlt?: boolean } = {}): boolean {
  let name = keyName(e);
  if (opts.ignoreAlt) name = name.replace("Alt+", "");
  return name === keyFor(action);
}

/** Other actions that already use `key` (to warn about conflicts). */
export function conflictsFor(action: Action, key: string): Action[] {
  return (Object.keys(ACTIONS) as Action[]).filter((a) => a !== action && keyFor(a) === key);
}
