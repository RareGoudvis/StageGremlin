// File menu actions (New, Open, Save, Save as), importing audio and analysing it.
// Buttons and keyboard shortcuts both call these, so each action lives in one place.

import { useDoc } from "../store";
import { ask, toast } from "../uiStore";
import type { Analysis, Cue, Pad } from "../types";
import { allCues, newCue, newId, newShow } from "../types";
import { addPads, findAnyCue, freePadKey, insertCues, locate, updateAnyCue } from "./showOps";
import {
  basename, call, dirname, isAudioPath, isTauri, needsConversion, pickAudioFiles, pickSavePath, pickShowToOpen, stripExt,
} from "./tauri";

const doc = () => useDoc.getState();
const isDirty = () => doc().show !== doc().savedShow;

async function okToDiscard(what: string): Promise<boolean> {
  if (!isDirty()) return true;
  return ask({
    title: "Unsaved changes",
    body: `“${doc().show.name}” has changes that are not saved. ${what} anyway and lose them?`,
    confirmLabel: `Discard and ${what.toLowerCase()}`,
    danger: true,
  });
}

export async function fileNew() {
  if (!(await okToDiscard("Start a new show"))) return;
  doc().loadShow(newShow(), null);
}

export async function fileOpen() {
  if (!(await okToDiscard("Open another show"))) return;
  const path = await pickShowToOpen();
  if (!path) return;
  try {
    const show = await call("show_open", { path });
    doc().loadShow(show, path);
    toast(`Opened ${basename(path)}`);
    // Fill in any cue that was never analysed, and flag formats we can't play.
    const s = doc().show;
    for (const c of [...allCues(s), ...s.pads.map((p) => p.cue)]) if (!c.loudness || needsConversion(c.file)) void analyseCue(c.id);
  } catch (e) {
    toast(`Could not open the show: ${e}`);
  }
}

let saving = false;

async function saveTo(path: string, quiet = false): Promise<boolean> {
  if (saving) return false;
  saving = true;
  const sent = doc().show;
  try {
    const saved = await call("show_save", { path, show: sent });
    doc().adoptSaved(saved, path, sent);
    if (!quiet) toast(isTauri ? `Saved ${basename(path)}` : `Downloaded ${basename(path)} (the audio files are not in it: import them again after opening)`);
    return true;
  } catch (e) {
    toast(`Save failed: ${e}`);
    return false;
  } finally {
    saving = false;
  }
}

export async function fileSave(): Promise<boolean> {
  const { path } = doc();
  if (!path) return fileSaveAs();
  return saveTo(path);
}

export async function fileSaveAs(): Promise<boolean> {
  const path = await pickSavePath(doc().show.name || "Show");
  return path ? saveTo(path) : false;
}

/** Called every 30 s while in Build. Only saves a show that already has a file. */
export async function autoSave() {
  // Browser mode: a save is a download, so never do it by itself.
  if (!isTauri) return;
  const { path, mode } = doc();
  if (mode === "build" && path && isDirty()) await saveTo(path, true);
}

// ---- import and analysis ----

export async function importDialog() {
  const files = await pickAudioFiles();
  if (files.length) importFiles(files);
}

/** Import audio as soundboard pads (each file becomes one pad with the next free hotkey). */
export async function importPadsDialog() {
  const files = await pickAudioFiles();
  if (files.length) importPadFiles(files);
}

export function importPadFiles(paths: string[]) {
  const audio = paths.filter(isAudioPath);
  if (!audio.length) return;
  const pads: Pad[] = [];
  for (const file of audio) {
    const hotkey = freePadKey(doc().show, pads.map((p) => p.hotkey));
    // Pads don't duck the background by default only if they're tiny; keep the cue default (duck on).
    pads.push({ id: newId(), hotkey, mode: "oneShot", cue: newCue({ name: stripExt(basename(file)), file, color: "#C6F432" }) });
  }
  doc().edit((s) => addPads(s, pads));
  doc().selectPad(pads[pads.length - 1].id);
  toast(`Added ${pads.length} pad${pads.length > 1 ? "s" : ""}`);
  for (const p of pads) void analyseCue(p.cue.id);
}

/** Add cues for files that are already on disk (YouTube downloads, swaps) after `afterId`. */
export function addCuesForFiles(files: { file: string; name: string }[], afterId: string | null, sectionId?: string): Cue[] {
  const cues = files.map((f) => newCue({ name: f.name, file: f.file }));
  doc().edit((s) => insertCues(s, cues, afterId && locate(s, afterId) ? afterId : null, sectionId));
  for (const c of cues) void analyseCue(c.id);
  return cues;
}

/** New cues land after the selected cue (or at the end of the last section). */
export function importFiles(paths: string[]) {
  const audio = paths.filter(isAudioPath);
  const skipped = paths.length - audio.length;
  if (!audio.length) {
    if (skipped) toast("Those files are not audio (mp3, wav, flac, m4a, aac, ogg, opus)");
    return;
  }
  const cues: Cue[] = audio.map((file) => newCue({ name: stripExt(basename(file)), file }));
  const { selection, show } = doc();
  // "After the selection" = after the selected cue that comes last in the show.
  const order = allCues(show).map((c) => c.id);
  const after = [...selection].sort((a, b) => order.indexOf(a) - order.indexOf(b)).pop() ?? null;
  doc().edit((s) => insertCues(s, cues, after && locate(s, after) ? after : null));
  doc().setSelection(cues.map((c) => c.id));
  toast(`Imported ${cues.length} file${cues.length > 1 ? "s" : ""}` + (skipped ? ` (${skipped} skipped: not audio)` : ""));
  for (const c of cues) void analyseCue(c.id);
}

// Waveforms are big; keep them in memory per file path rather than in the document.
const waveforms = new Map<string, number[]>();
const waveListeners = new Set<() => void>();

export function getWaveform(file: string): number[] | undefined {
  return waveforms.get(file);
}

export function onWaveformsChanged(cb: () => void): () => void {
  waveListeners.add(cb);
  return () => waveListeners.delete(cb);
}

const inFlight = new Map<string, Promise<Analysis>>();

/** Analyse one file (deduplicated per path). The Rust side caches results too. */
function analyseFile(file: string): Promise<Analysis> {
  const baseDir = dirname(doc().path);
  let p = inFlight.get(file);
  if (!p) {
    p = call("analyze_file", { baseDir, file }).finally(() => inFlight.delete(file));
    inFlight.set(file, p);
  }
  return p;
}

/**
 * Measure loudness for a cue and fetch its waveform. The result is merged into
 * every undo snapshot, so it never shows up as its own undo step.
 */
export async function analyseCue(cueId: string) {
  const cue = findAnyCue(doc().show, cueId);
  if (!cue?.file) return;
  if (needsConversion(cue.file)) {
    // Don't even try: the decoder can't read opus/webm. The UI offers "Convert to M4A".
    doc().setAnalysis(cueId, { state: "error", message: "Can't play this format (opus/webm). Convert it to M4A.", unsupported: true });
    return;
  }
  doc().setAnalysis(cueId, { state: "busy" });
  try {
    const a = await analyseFile(cue.file);
    waveforms.set(cue.file, a.waveform);
    waveListeners.forEach((cb) => cb());
    if (!cue.loudness || cue.loudness.lufs !== a.loudness.lufs || cue.loudness.duration !== a.loudness.duration) {
      doc().mergeLoudness(cueId, a.loudness);
    }
    doc().setAnalysis(cueId, null);
  } catch (e) {
    const message = String(e);
    // A decode failure means the format is the problem, not a missing file.
    const unsupported = /unsupported|codec|decod/i.test(message);
    doc().setAnalysis(cueId, { state: "error", message: unsupported ? `Can't play this format: ${message}` : message, unsupported });
  }
}

// ---- where downloaded / converted files go ----

let dataDir: string | null = null;

/** The show's media/ folder when saved, otherwise <dataDir>/downloads (see ipc-wave2.md). */
export async function mediaDestDir(): Promise<string> {
  const { path } = doc();
  const dir = dirname(path);
  const sep = (path ?? "").includes("\\") ? "\\" : "/";
  if (dir) return `${dir}${sep}media`;
  if (!dataDir) dataDir = (await call("app_info")).dataDir;
  return `${dataDir}/downloads`;
}

/**
 * Convert a cue's opus/webm file to m4a with ffmpeg and point the cue at the new file.
 * Returns false when ffmpeg is missing (the caller shows the install button).
 */
export async function convertCue(cueId: string): Promise<boolean> {
  const cue = findAnyCue(doc().show, cueId);
  if (!cue) return true;
  const st = await call("yt_status");
  if (!st.ffmpeg) return false;
  doc().setAnalysis(cueId, { state: "converting" });
  try {
    const newPath = await call("media_convert", { path: cue.file, destDir: await mediaDestDir() });
    doc().edit((s) => updateAnyCue(s, cueId, { file: newPath }), { allowInRun: true });
    toast(`Converted ${basename(cue.file)} to M4A`);
    await analyseCue(cueId);
  } catch (e) {
    doc().setAnalysis(cueId, { state: "error", message: `Conversion failed: ${e}`, unsupported: true });
  }
  return true;
}

/** For the inspector: get a waveform for a cue that was analysed in an earlier session. */
export function ensureWaveform(cueId: string) {
  const cue = findAnyCue(doc().show, cueId);
  if (!cue?.file || waveforms.has(cue.file) || inFlight.has(cue.file)) return;
  if (doc().analysis[cueId]) return;
  void analyseCue(cueId);
}
