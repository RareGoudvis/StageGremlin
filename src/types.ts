// Mirrors crates/engine/src/show.rs and player.rs. Keep in sync when fields change.

export type Curve = "linear" | "sCurve" | "exponential";

export interface Notes { sound: string; lx: string; stage: string }

export type Follow =
  | { kind: "none" }
  | { kind: "afterEnd" }
  | { kind: "afterStart"; delay: number };

export interface EqBand { freq: number; gainDb: number; q: number; on: boolean }

export interface Compressor {
  on: boolean; thresholdDb: number; ratio: number; attackMs: number; releaseMs: number; makeupDb: number;
}

export interface Loudness { lufs: number; truePeakDb: number; lra: number; duration: number }
export interface Vamp { a: number; b: number; on: boolean }
export interface Marker { t: number; label: string }
export interface Attach { to: string; at: number }

export interface Cue {
  id: string;
  number: string;
  name: string;
  /** Relative to the show folder once saved ("media/x.mp3"); absolute before the first save. */
  file: string;
  color: string | null;
  notes: Notes;
  trimIn: number;
  trimOut: number | null;
  gainDb: number;
  pan: number;
  hpf: number | null;
  eq: [EqBand, EqBand, EqBand, EqBand];
  comp: Compressor;
  fadeIn: number;
  fadeOut: number;
  stopFade: number;
  curve: Curve;
  preWait: number;
  /** 1–5 passes; 0 = loop until stopped. */
  playCount: number;
  follow: Follow;
  duckBg: boolean;
  underDb: number | null;
  fadeGo: number | null;
  vamp: Vamp | null;
  markers: Marker[];
  attach: Attach | null;
  loudness: Loudness | null;
  swappedFrom: string | null;
}

export interface Section { id: string; name: string; color: string | null; cues: Cue[] }

export interface ShowSettings {
  targetLufs: number;
  peakCeilingDb: number;
  limiterCeilingDb: number;
  stopAllFade: number;
  doubleGoMs: number;
  underDb: number;
  underFade: number;
}

export type PadMode = "oneShot" | "toggle" | "loop";
/** Soundboard pad: the sound settings live in `cue` (same chain and editor as cues). */
export interface Pad { id: string; hotkey: string; mode: PadMode; cue: Cue }

export interface Show { version: number; name: string; settings: ShowSettings; sections: Section[]; pads: Pad[]; /** Background player settings (BgConfig + source), owned by the background module. */ background?: unknown | null }

export type ToneKind = "pink" | "line";

export interface Analysis { loudness: Loudness; sampleRate: number; channels: number; waveform: number[] }

export interface RunningInfo {
  instance: number;
  cueId: string;
  number: string;
  name: string;
  position: number;
  length: number;
  remaining: number;
  pass: number;
  playCount: number;
  under: boolean;
  vamping: boolean;
  stopping: boolean;
  attached: boolean;
  /** Set when this is a soundboard pad. */
  padId: string | null;
  /** This cue ducks the background player while it plays. */
  duckBg: boolean;
  /** [label, seconds until] */
  nextMarker: [string, number] | null;
}

export type PendingKind = "preWait" | "follow" | "attached";
export interface PendingInfo { cueId: string; kind: PendingKind; inSecs: number }

export interface MeterReading {
  peakL: number;
  peakR: number;
  grDb: number;
  overs: number;
  /** Short-term loudness of the output (EBU R128, 3 s), LUFS; −70 = silence. Updates ~10×/s. */
  lufsS: number;
}

export interface LogEntry { clock: number; wallMs: number; kind: string; cueId: string | null; text: string }

export interface EngineState {
  clock: number;
  playhead: string | null;
  running: RunningInfo[];
  pending: PendingInfo[];
  meter: MeterReading;
  newLog: LogEntry[];
}

/** One audio output from audio_list_outputs. */
export interface OutputDevice { name: string; isDefault: boolean }

/** engine://output and audio_output_status: where the engine plays now. */
export interface OutputStatus { outputName: string; outputFound: boolean; preferred: string | null }

export type GoResult = "fired" | "ignored" | "endOfShow";

// ---- helpers mirroring show.rs ----

export function normGain(l: Loudness | null, s: ShowSettings): { gainDb: number; peakLimited: boolean } {
  if (!l || !Number.isFinite(l.lufs)) return { gainDb: 0, peakLimited: false };
  const wanted = s.targetLufs - l.lufs;
  const cap = s.peakCeilingDb - l.truePeakDb;
  return wanted > cap ? { gainDb: cap, peakLimited: true } : { gainDb: wanted, peakLimited: false };
}

export function trimmedLen(c: Cue): number | null {
  if (!c.loudness) return null;
  const d = c.loudness.duration;
  return Math.max(0, Math.min(c.trimOut ?? d, d) - c.trimIn);
}

// ---- factories and helpers added by the UI (mirror the Default impls in show.rs) ----

export const FORMAT_VERSION = 1;

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // Fallback for very old browsers: good enough for ids that only need to be unique within a show.
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function defaultEq(): [EqBand, EqBand, EqBand, EqBand] {
  return [
    { freq: 100, gainDb: 0, q: 0.7, on: true },
    { freq: 500, gainDb: 0, q: 1.0, on: true },
    { freq: 2500, gainDb: 0, q: 1.0, on: true },
    { freq: 8000, gainDb: 0, q: 0.7, on: true },
  ];
}

export function defaultCompressor(): Compressor {
  return { on: false, thresholdDb: -18, ratio: 2, attackMs: 10, releaseMs: 150, makeupDb: 0 };
}

export function defaultSettings(): ShowSettings {
  return { targetLufs: -14, peakCeilingDb: -1, limiterCeilingDb: -1, stopAllFade: 2, doubleGoMs: 300, underDb: -12, underFade: 1 };
}

export function newCue(partial: Partial<Cue> = {}): Cue {
  return {
    id: newId(), number: "", name: "", file: "", color: null,
    notes: { sound: "", lx: "", stage: "" },
    trimIn: 0, trimOut: null, gainDb: 0, pan: 0, hpf: null,
    eq: defaultEq(), comp: defaultCompressor(),
    fadeIn: 0, fadeOut: 0, stopFade: 1, curve: "sCurve",
    preWait: 0, playCount: 1, follow: { kind: "none" },
    duckBg: true, underDb: null, fadeGo: null, vamp: null, markers: [], attach: null,
    loudness: null, swappedFrom: null,
    ...partial,
  };
}

export function newSection(name = "Section"): Section {
  return { id: newId(), name, color: null, cues: [] };
}

export function newShow(): Show {
  return { version: FORMAT_VERSION, name: "New show", settings: defaultSettings(), sections: [newSection("Opening")], pads: [] };
}

/** Every cue in show order (sections flattened). */
export function allCues(show: Show): Cue[] {
  return show.sections.flatMap((s) => s.cues);
}

/** Cues GO steps through: everything that is not attached to another cue. */
export function goQueue(show: Show): Cue[] {
  return allCues(show).filter((c) => !c.attach);
}

/**
 * Port of Show::renumber: top-level cues 1, 2, 3…; attached cues parent.1, parent.2.
 * Returns a new show (only cues whose number changed are copied).
 */
export function renumber(show: Show): Show {
  const nums = new Map<string, string>();
  let n = 0;
  for (const c of allCues(show)) if (!c.attach) nums.set(c.id, String(++n));
  const childCount = new Map<string, number>();
  for (const c of allCues(show)) {
    if (!c.attach) continue;
    const k = (childCount.get(c.attach.to) ?? 0) + 1;
    childCount.set(c.attach.to, k);
    nums.set(c.id, `${nums.get(c.attach.to) ?? "?"}.${k}`);
  }
  let changed = false;
  const sections = show.sections.map((s) => {
    let secChanged = false;
    const cues = s.cues.map((c) => {
      const num = nums.get(c.id) ?? c.number;
      if (num === c.number) return c;
      secChanged = true;
      return { ...c, number: num };
    });
    if (!secChanged) return s;
    changed = true;
    return { ...s, cues };
  });
  return changed ? { ...show, sections } : show;
}

/** Playing length of one pass (trim applied); 0 when the file has not been analysed yet. */
export function passLen(c: Cue): number {
  return trimmedLen(c) ?? 0;
}

// ---- round 2 (src-tauri payloads; see docs/ipc.md) ----

/** `preview://state`. sameAsShow = preview would be heard in the hall. */
export interface PreviewState {
  playing: boolean;
  name: string | null;
  position: number;
  length: number;
  outputName: string;
  sameAsShow: boolean;
}

export type AppMode = "build" | "preflight" | "run";

/** position = seconds into the file (trim included); pass straight to `engine_resume`. */
export interface ResumeItem { cueId: string; name?: string; position: number }

export interface ResumeInfo { showPath: string; playhead: string | null; running: ResumeItem[]; savedAtMs: number }

export interface YtStatus { ytDlp: string | null; ffmpeg: boolean; binDir: string }

export type YtTool = "ytDlp" | "ffmpeg";

export type YtFormat = "original" | "mp3" | "wav";

/** `yt://install`. */
export interface YtInstallProgress { what: YtTool; percent: number; done: boolean; error: string | null }

export interface YtItem {
  id: string;
  input: string;
  url: string;
  title: string;
  channel: string;
  duration: number;
  playlist: string | null;
  error: string | null;
}

export interface YtDownloadItem { id: string; url: string; title: string }

/** `yt://progress`. */
export interface YtProgress {
  id: string;
  percent: number;
  status: "queued" | "downloading" | "converting" | "done" | "error";
  file: string | null;
  error: string | null;
}
export type YtProgressStatus = YtProgress["status"];

// ---- round 3 ----

/** `media://changed` (debounced 500 ms). */
export interface MediaChanged { path: string; kind: "modified" | "removed" | "created" }

/** Per-machine UI settings (`settings_get` / `settings_set`); free-form, the core never reads it. */
export type UiSettings = Record<string, unknown>;
