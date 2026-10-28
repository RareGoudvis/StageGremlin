// File menu actions (New, Open, Save, Save as), importing audio and analysing it.
// Buttons and keyboard shortcuts both call these, so each action lives in one place.

import { useDoc } from "../store";
import { ask, toast } from "../uiStore";
import type { Analysis, Cue, Pad } from "../types";
import { allCues, newCue, newId, newShow } from "../types";
import { rememberRecent } from "../settingsStore";
import { addPads, findAnyCue, freePadKey, insertCues, locate, updateAnyCue } from "./showOps";
import {
  basename, call, dirname, isAudioPath, isTauri, needsConversion, pickAudioFiles, pickSavePath, pickShowToOpen, stripExt,
} from "./tauri";
import { tr } from "../i18n";

const doc = () => useDoc.getState();
const isDirty = () => doc().show !== doc().savedShow;

/** `next`: what happens after discarding: a new show, or opening another one. */
async function okToDiscard(next: "new" | "open"): Promise<boolean> {
  if (!isDirty()) return true;
  const name = doc().show.name;
  return ask({
    title: tr("b.file.unsaved"),
    body: next === "new" ? tr("b.file.bodyNew", { name }) : tr("b.file.bodyOpen", { name }),
    confirmLabel: next === "new" ? tr("b.file.confirmNew") : tr("b.file.confirmOpen"),
    danger: true,
  });
}

export async function fileNew() {
  if (!(await okToDiscard("new"))) return;
  doc().loadShow(newShow(), null);
}

export async function fileOpen() {
  if (!(await okToDiscard("open"))) return;
  const path = await pickShowToOpen();
  if (path) await openShowFile(path);
}

/** File › Open recent: open a show we already know the path of. */
export async function fileOpenRecent(path: string) {
  if (!(await okToDiscard("open"))) return;
  await openShowFile(path);
}

async function openShowFile(path: string) {
  try {
    const show = await call("show_open", { path });
    doc().loadShow(show, path);
    if (isTauri) rememberRecent(path);
    toast(tr("b.file.opened", { file: basename(path) }));
    // Fill in any cue that was never analysed, and flag formats we can't play.
    const s = doc().show;
    for (const c of [...allCues(s), ...s.pads.map((p) => p.cue)]) if (!c.loudness || needsConversion(c.file)) void analyseCue(c.id);
  } catch (e) {
    toast(tr("b.file.openFailed", { e: String(e) }));
  }
}

let saving = false;

async function saveTo(path: string, quiet = false): Promise<boolean> {
  if (saving) return false;
  saving = true;
  const sent = doc().show;
  try {
    // Where the show lives now: "Save as" into another folder copies the media from there.
    const fromDir = dirname(doc().path);
    const saved = await call("show_save", { path, show: sent, fromDir });
    doc().adoptSaved(saved, path, sent);
    if (isTauri && !quiet) rememberRecent(path);
    if (!quiet) toast(isTauri ? tr("b.file.saved", { file: basename(path) }) : tr("b.file.downloaded", { file: basename(path) }));
    return true;
  } catch (e) {
    toast(tr("b.file.saveFailed", { e: String(e) }));
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

/** `sectionId`: import at the end of that section (from its right-click menu). */
export async function importDialog(sectionId?: string) {
  const files = await pickAudioFiles();
  if (files.length) importFiles(files, sectionId);
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
  toast(pads.length > 1 ? tr("b.file.padsN", { n: pads.length }) : tr("b.file.pads1"));
  for (const p of pads) void analyseCue(p.cue.id);
}

/** Add cues for files that are already on disk (YouTube downloads, swaps) after `afterId`. */
export function addCuesForFiles(files: { file: string; name: string }[], afterId: string | null, sectionId?: string): Cue[] {
  const cues = files.map((f) => newCue({ name: f.name, file: f.file }));
  doc().edit((s) => insertCues(s, cues, afterId && locate(s, afterId) ? afterId : null, sectionId));
  for (const c of cues) void analyseCue(c.id);
  return cues;
}

/** The selected cue that comes last in the show: "after the selection" means after this one. */
export function lastSelected(): string | null {
  const { selection, show } = doc();
  const order = allCues(show).map((c) => c.id);
  return [...selection].sort((a, b) => order.indexOf(a) - order.indexOf(b)).pop() ?? null;
}

/**
 * New cues land after the selected cue (or at the end of the last section).
 * `sectionId`: at the end of that section instead. `afterId`: after that cue instead (the Add window's choice).
 */
export function importFiles(paths: string[], sectionId?: string, afterId?: string | null) {
  const audio = paths.filter(isAudioPath);
  const skipped = paths.length - audio.length;
  if (!audio.length) {
    if (skipped) toast(tr("b.file.notAudio"));
    return;
  }
  const cues: Cue[] = audio.map((file) => newCue({ name: stripExt(basename(file)), file }));
  const after = sectionId ? null : afterId !== undefined ? afterId : lastSelected();
  doc().edit((s) => insertCues(s, cues, after && locate(s, after) ? after : null, sectionId));
  doc().setSelection(cues.map((c) => c.id));
  const n = cues.length;
  if (skipped) toast(n > 1 ? tr("b.file.impNSkipped", { n, k: skipped }) : tr("b.file.imp1Skipped", { k: skipped }));
  else toast(n > 1 ? tr("b.file.impN", { n }) : tr("b.file.imp1"));
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
    doc().setAnalysis(cueId, { state: "error", message: tr("b.file.cantPlayOpus"), unsupported: true });
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
    doc().setAnalysis(cueId, { state: "error", message: unsupported ? tr("b.file.cantPlay", { e: message }) : message, unsupported });
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
    toast(tr("b.file.converted", { file: basename(cue.file) }));
    await analyseCue(cueId);
  } catch (e) {
    doc().setAnalysis(cueId, { state: "error", message: tr("b.file.convertFailed", { e: String(e) }), unsupported: true });
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

/** File › Export show as zip: the show file plus its media/ folder, for a USB stick or a colleague. */
export async function exportZip() {
  if (!isTauri) return toast(tr("b.file.zipDesktop"));
  // The zip is made from the saved show, so save first.
  if (!doc().path || isDirty()) {
    const ok = await ask({ title: tr("b.file.saveFirst"), body: tr("b.file.saveFirstBody"), confirmLabel: tr("b.file.saveExport") });
    if (!ok || !(await fileSave())) return;
  }
  const { save } = await import("@tauri-apps/plugin-dialog");
  const dest = await save({ defaultPath: `${doc().show.name || "Show"}.zip`, filters: [{ name: "Zip", extensions: ["zip"] }] });
  if (!dest) return;
  try {
    await call("show_export_zip", { showPath: doc().path!, dest });
    toast(tr("b.file.exported", { file: basename(dest) }));
  } catch (e) {
    toast(tr("b.file.exportFailed", { e: String(e) }));
  }
}
