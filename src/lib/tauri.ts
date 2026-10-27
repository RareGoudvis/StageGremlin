// One place that talks to Tauri. Everything else in the UI calls these helpers,
// so the app still renders in a plain browser (`npm run dev`) for design work:
// without Tauri, commands are logged and answered by a small simulator (mockEngine.ts).

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Analysis, Cue, EngineState, GoResult, OutputDevice, OutputStatus, Show, ToneKind } from "../types";
import type {
  AppMode, PreviewState, ResumeInfo, YtFormat, YtInstallProgress, YtItem, YtProgress, YtStatus, YtTool,
} from "../types";
export type { OutputStatus };
// Browser mode: real sound through the Web Audio API (webAudioEngine.ts); it hands what it
// can't do (YouTube, preview, …) to the simulator (mockEngine.ts).
import { webInvoke as mockInvoke, webListen as mockListen } from "./webAudioEngine";
import { pickFiles, registerFile } from "./browserFiles";

export const isTauri: boolean =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Typed list of the commands in docs/ipc.md. */
export interface Commands {
  engine_set_show: { args: { show: Show; baseDir: string | null }; ret: void };
  engine_go: { args: undefined; ret: GoResult };
  engine_stop_all: { args: undefined; ret: void };
  engine_panic: { args: undefined; ret: void };
  engine_stop_cue: { args: { cueId: string }; ret: void };
  engine_toggle_under: { args: { cueId: string | null }; ret: void };
  engine_release_vamp: { args: { cueId: string | null }; ret: void };
  engine_set_playhead: { args: { cueId: string | null }; ret: void };
  show_open: { args: { path: string }; ret: Show };
  show_save: { args: { path: string; show: Show; fromDir: string | null }; ret: Show };
  analyze_file: { args: { baseDir: string | null; file: string }; ret: Analysis };
  app_info: { args: undefined; ret: { version: string; portable: boolean; dataDir: string; build?: string | null } };
  /** Asks GitHub for the newest release (src-tauri/src/updates.rs). */
  app_check_update: { args: undefined; ret: { current: string | null; latest: string | null; url: string | null; newer: boolean } };
  /** Opens one of StageGremlin's own release pages in the browser (nothing else is allowed). */
  open_release_page: { args: { url: string }; ret: void };
  /** Search the network for cast targets (src-tauri/src/streambox.rs); takes ~4 s. */
  net_probe: { args: { ip: string }; ret: { ip: string; name: string; model: string | null; kinds: string[]; dlnaUrl: string | null } };
  net_discover: { args: undefined; ret: { ip: string; name: string; model: string | null; kinds: string[]; dlnaUrl: string | null }[] };
  audio_list_outputs: { args: undefined; ret: AudioOutput[] };
  audio_output_status: { args: undefined; ret: OutputStatus };
  /** Windows' default output device: where the background player (WebView2) actually plays. */
  audio_default_output: { args: undefined; ret: { name: string | null } };
  /** Opens Windows Settings › Sound. */
  open_sound_settings: { args: undefined; ret: void };
  /** null = follow the Windows default output. Rebuilds the engine (cuts sound): never offer it in Run. */
  audio_set_output: { args: { name: string | null }; ret: void };

  // ---- round 2 (docs/ipc-wave2.md) ----
  engine_pad: { args: { padId: string }; ret: void };
  engine_go_from: { args: { cueId: string; at: number }; ret: void };
  /** `hz`: the sine's frequency (20–20 000, default 1000); pink noise ignores it. */
  engine_tone: { args: { kind: ToneKind | null; hz?: number }; ret: void };
  audio_set_preview_output: { args: { name: string | null }; ret: void };
  preview_play: { args: { cue: Cue; baseDir: string | null; at: number }; ret: void };
  preview_stop: { args: undefined; ret: void };
  app_session: { args: { showPath: string | null; mode: AppMode }; ret: void };
  engine_resume: { args: { items: { cueId: string; position: number }[] }; ret: void };
  app_resume_info: { args: undefined; ret: ResumeInfo | null };
  app_resume_dismiss: { args: undefined; ret: void };
  yt_status: { args: undefined; ret: YtStatus };
  yt_install: { args: { what: YtTool }; ret: void };
  yt_resolve: { args: { lines: string[] }; ret: YtItem[] };
  yt_download: { args: { items: { id: string; url: string; title: string }[]; format: YtFormat; destDir: string }; ret: void };
  /** ffmpeg conversion of a file the decoder can't play (opus/webm) to m4a. Returns the new path. */
  media_convert: { args: { path: string; destDir: string }; ret: string };

  // ---- round 3 (names as announced; check docs/ipc.md) ----
  /** One boolean per (absolute) path: does the file exist. */
  file_exists: { args: { paths: string[] }; ret: boolean[] };
  /** P in Run: pause / resume everything. Returns true when now paused. GO while paused resumes. */
  engine_pause_all: { args: undefined; ret: boolean };
  show_in_folder: { args: { path: string }; ret: void };
  /** Watch a folder; changes arrive as media://changed. */
  media_watch: { args: { dir: string }; ret: void };
  show_export_zip: { args: { showPath: string; dest: string }; ret: void };
  /** Per-machine settings; the UI keeps its own under `ui`. */
  settings_get: { args: undefined; ret: { ui?: unknown } & Record<string, unknown> };
  settings_set: { args: { patch: Record<string, unknown> }; ret: void };
}

export type AudioOutput = OutputDevice;

export async function call<K extends keyof Commands>(
  cmd: K,
  ...args: Commands[K]["args"] extends undefined ? [] : [Commands[K]["args"]]
): Promise<Commands[K]["ret"]> {
  const a = args[0] as Record<string, unknown> | undefined;
  if (isTauri) return invoke<Commands[K]["ret"]>(cmd, a);
  return mockInvoke(cmd, a) as Promise<Commands[K]["ret"]>;
}

export interface Events {
  "engine://state": EngineState;
  "engine://error": string;
  "engine://output": OutputStatus;
  "preview://state": PreviewState;
  "yt://progress": YtProgress;
  "yt://install": YtInstallProgress;
  "media://changed": { path: string; kind: string };
}

export async function on<K extends keyof Events>(event: K, cb: (payload: Events[K]) => void): Promise<UnlistenFn> {
  if (isTauri) return listen<Events[K]>(event, (e) => cb(e.payload));
  return mockListen(event, cb as (p: unknown) => void);
}

// ---- file dialogs ----

/** Formats our decoder (symphonia) can play. Offered in the import dialog. */
export const AUDIO_EXTS = ["mp3", "wav", "flac", "m4a", "aac", "ogg"];
/** Audio we accept (e.g. dropped files) but can't play until converted to m4a. */
export const CONVERT_EXTS = ["opus", "webm"];

export function extOf(p: string): string {
  return p.split(".").pop()?.toLowerCase() ?? "";
}

export function isAudioPath(p: string): boolean {
  return AUDIO_EXTS.includes(extOf(p)) || CONVERT_EXTS.includes(extOf(p));
}

export function needsConversion(p: string): boolean {
  // Edge/Chrome decode opus and webm themselves; only the desktop decoder needs a conversion.
  if (!isTauri) return false;
  return CONVERT_EXTS.includes(extOf(p));
}

export async function pickAudioFiles(): Promise<string[]> {
  if (!isTauri) {
    // Browser: the files stay in this tab; cue.file gets a "browser:…" key (browserFiles.ts).
    const picked = await pickFiles("audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg,.opus,.webm", true);
    return picked.map(registerFile);
  }
  const { open } = await import("@tauri-apps/plugin-dialog");
  const res = await open({ multiple: true, directory: false, filters: [{ name: "Audio", extensions: AUDIO_EXTS }] });
  if (!res) return [];
  return Array.isArray(res) ? res : [res];
}

export async function pickShowToOpen(): Promise<string | null> {
  if (!isTauri) {
    const [f] = await pickFiles(".sg,.cueplay,application/json", false);
    return f ? registerFile(f) : null;
  }
  const { open } = await import("@tauri-apps/plugin-dialog");
  // Old .cueplay files still open; new shows are saved as .sg.
  const res = await open({ multiple: false, directory: false, filters: [{ name: "StageGremlin show", extensions: ["sg", "cueplay"] }] });
  return typeof res === "string" ? res : null;
}

export async function pickSavePath(suggestedName: string): Promise<string | null> {
  // Browser: "saving" downloads the show file under this name.
  if (!isTauri) return suggestedName + ".sg";
  const { save } = await import("@tauri-apps/plugin-dialog");
  const res = await save({ defaultPath: suggestedName + ".sg", filters: [{ name: "StageGremlin show", extensions: ["sg"] }] });
  if (!res) return null;
  return res.toLowerCase().endsWith(".sg") ? res : res + ".sg";
}

export async function setWindowTitle(title: string): Promise<void> {
  document.title = title;
  if (!isTauri) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setTitle(title);
  } catch {
    // Needs the core:window:allow-set-title permission; document.title is the fallback.
  }
}

/**
 * Files dropped from Explorer onto the window. Tauri delivers real paths;
 * a browser cannot, so outside Tauri this does nothing.
 */
export async function onFileDrop(handlers: {
  over: (on: boolean) => void;
  drop: (paths: string[]) => void;
}): Promise<UnlistenFn> {
  if (!isTauri) return () => {};
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  return getCurrentWebview().onDragDropEvent((e) => {
    const p = e.payload;
    if (p.type === "enter" || p.type === "over") handlers.over(true);
    else if (p.type === "leave") handlers.over(false);
    else if (p.type === "drop") {
      handlers.over(false);
      handlers.drop(p.paths);
    }
  });
}

// ---- path helpers (Windows and POSIX separators) ----

export function dirname(p: string | null): string | null {
  if (!p) return null;
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i > 0 ? p.slice(0, i) : null;
}

/** A cue's file as an absolute path: saved shows store "media/x.mp3" relative to the show folder. */
export function absolutePath(file: string, showPath: string | null): string {
  if (/^([a-zA-Z]:[\\/]|[\\/]|browser:)/.test(file)) return file;
  const dir = dirname(showPath);
  if (!dir) return file;
  const sep = dir.includes("\\") ? "\\" : "/";
  return dir + sep + file.replace(/[\\/]/g, sep);
}

export function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

export function stripExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}
