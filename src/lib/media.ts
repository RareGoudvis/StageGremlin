// Which cue files exist on disk, and fixing the ones that don't.
// Checked when a show opens, after saves, when the media folder changes (media://changed),
// and shortly after the cue list changes. Run is blocked while anything is missing.

import { create } from "zustand";
import { useDoc } from "../store";
import { ask, toast, useUi } from "../uiStore";
import { useSettings } from "../settingsStore";
import type { Cue } from "../types";
import { allCues } from "../types";
import { findAnyCue, updateAnyCue } from "./showOps";
import { analyseCue } from "./fileActions";
import { absolutePath, basename, call, dirname, isAudioPath, pickAudioFiles } from "./tauri";
import { filesSignature, runGate, type CheckState, type GateResult } from "./runGate";

interface MediaStore {
  /** cue id → true when its file is not on disk. */
  missing: Record<string, boolean>;
  /**
   * Audio files seen in the show folder through media://changed (there is no "list folder"
   * command, so files that were already there before the app started only show up once used).
   */
  seen: string[];
  /** Someone tried to turn on Dumbo mode while files were missing (Preflight explains). */
  dumboBlocked: boolean;
  /** The last file check: running, finished, or failed (with why), and for which files. */
  checkState: CheckState;
  checkError: string;
  checkedSignature: string;
  set: (missing: Record<string, boolean>) => void;
  onChanged: (path: string, kind: string) => void;
}

export const useMedia = create<MediaStore>((set) => ({
  missing: {},
  seen: [],
  dumboBlocked: false,
  checkState: "idle",
  checkError: "",
  checkedSignature: "",
  set: (missing) => set({ missing }),
  onChanged: (path, kind) =>
    set((s) => {
      if (!isAudioPath(path)) return s;
      const gone = /remove|delete/i.test(kind);
      const seen = s.seen.filter((p) => p !== path);
      return { seen: gone ? seen : [...seen, path] };
    }),
}));

/** Every cue that has a file: show cues and pad cues. */
export function cuesWithFiles(): Cue[] {
  const s = useDoc.getState().show;
  return [...allCues(s), ...s.pads.map((p) => p.cue)].filter((c) => c.file);
}

let checking = 0;

export async function checkFiles() {
  const run = ++checking;
  const cues = cuesWithFiles();
  const path = useDoc.getState().path;
  const signature = filesSignature(cues);
  useMedia.setState({ checkState: "checking", checkError: "" });
  try {
    const exists = await call("file_exists", { paths: cues.map((c) => absolutePath(c.file, path)) });
    if (run !== checking) return; // a newer check started meanwhile
    if (!Array.isArray(exists) || exists.length !== cues.length) throw new Error("the file check returned an incomplete answer");
    const missing: Record<string, boolean> = {};
    cues.forEach((c, i) => {
      if (exists[i] !== true) missing[c.id] = true;
    });
    useMedia.setState({ missing, checkState: "ok", checkedSignature: signature });
    // Anything never analysed gets analysed now, so "not analysed" can't slip into Run.
    const analysis = useDoc.getState().analysis;
    for (const c of cues) if (!missing[c.id] && !c.loudness && !analysis[c.id]) void analyseCue(c.id);
  } catch (e) {
    if (run !== checking) return;
    // A check that errors must never count as "all fine".
    useMedia.setState({ checkState: "failed", checkError: String(e) });
    console.warn("[cueplay] file_exists", e);
  }
}

/** The Run/Dumbo gate for the show as it is right now. */
export function currentGate(): GateResult {
  const m = useMedia.getState();
  const cues = cuesWithFiles();
  const analysis = useDoc.getState().analysis;
  return runGate({
    checkState: m.checkState,
    checkError: m.checkError,
    checkedCurrent: m.checkedSignature === filesSignature(cues),
    missing: cues.filter((c) => m.missing[c.id]).map((c) => c.id),
    unreadable: cues.filter((c) => analysis[c.id]?.state === "error").map((c) => c.id),
    analysing: cues.filter((c) => analysis[c.id]?.state === "busy").map((c) => c.id),
  });
}

export function missingCues(): Cue[] {
  const m = useMedia.getState().missing;
  return cuesWithFiles().filter((c) => m[c.id]);
}

/** Watch the show's folder so files added/removed outside the app are noticed. */
export async function watchShowFolder() {
  const dir = dirname(useDoc.getState().path);
  if (dir) await call("media_watch", { dir }).catch((e) => console.warn("[cueplay] media_watch", e));
}

/**
 * Locate…: pick the file for one missing cue. Then look in that folder for the other
 * missing files (same file name) and offer to relink them all in one go.
 */
export async function locateCue(cueId: string) {
  const cue = findAnyCue(useDoc.getState().show, cueId);
  if (!cue) return;
  const [file] = await pickAudioFiles();
  if (!file) return;
  const patches: [string, string][] = [[cueId, file]];

  const dir = dirname(file);
  const others = missingCues().filter((c) => c.id !== cueId);
  if (dir && others.length) {
    const sep = dir.includes("\\") ? "\\" : "/";
    const candidates = others.map((c) => `${dir}${sep}${basename(c.file)}`);
    const found = await call("file_exists", { paths: candidates }).catch(() => candidates.map(() => false));
    const hits = others.filter((_, i) => found[i]);
    if (hits.length) {
      const ok = await ask({
        title: `Found ${hits.length} more missing file${hits.length > 1 ? "s" : ""}`,
        body: `The same folder also has ${hits.map((c) => basename(c.file)).slice(0, 5).join(", ")}${hits.length > 5 ? "…" : ""}. Relink ${hits.length > 1 ? "them" : "it"} too?`,
        confirmLabel: "Relink all",
        cancelLabel: "Only this one",
      });
      if (ok) hits.forEach((c) => patches.push([c.id, `${dir}${sep}${basename(c.file)}`]));
    }
  }
  relink(patches);
}

/** Replace…: a different file for this cue; all its settings stay. */
export async function replaceCueFile(cueId: string) {
  const [file] = await pickAudioFiles();
  if (file) relink([[cueId, file]]);
}

/** One undo step for all relinks, then re-check and re-analyse. */
function relink(patches: [string, string][]) {
  useDoc.getState().edit((s) => patches.reduce((acc, [id, file]) => updateAnyCue(acc, id, { file, loudness: null }), s));
  toast(patches.length > 1 ? `Relinked ${patches.length} files` : `Relinked ${basename(patches[0][1])}`);
  void checkFiles();
  for (const [id] of patches) void analyseCue(id);
}

/** Reload from disk: the file changed outside the app; measure it again. */
export async function reloadCue(cueId: string) {
  await checkFiles();
  await analyseCue(cueId);
}

export async function showInFolder(cueId: string) {
  const cue = findAnyCue(useDoc.getState().show, cueId);
  if (!cue) return;
  await call("show_in_folder", { path: absolutePath(cue.file, useDoc.getState().path) }).catch((e) => toast(`Can't open the folder: ${e}`));
}

/**
 * Run opens only when the file check finished for the show as it is now and found every cue and
 * pad file present and readable. Otherwise: say why and go to Preflight (and re-check if needed).
 */
export function canEnterRun(): boolean {
  const g = currentGate();
  if (g.ok) return true;
  const m = useMedia.getState();
  if (m.checkState !== "checking") void checkFiles();
  toast(`Run is blocked: ${g.reason} (see Preflight).`);
  useDoc.getState().setMode("preflight");
  return false;
}

/**
 * Dumbo mode follows the same rule as Run: not while a cue file is missing.
 * Instead it opens Preflight, which lists the missing files with a "fix these first" line.
 */
export function enableDumbo(): boolean {
  const ui = useSettings.getState();
  // Same gate as Run: the file check must have finished OK for the show as it is now.
  const g = currentGate();
  if (!g.ok) {
    useMedia.setState({ dumboBlocked: true });
    if (useMedia.getState().checkState !== "checking") void checkFiles();
    useUi.getState().closeDialog();
    useDoc.getState().setMode("preflight");
    toast(ui.ui.lang === "nl" ? `Eerst oplossen, dan Dumbo-modus: ${g.reason}` : `Fix this first, then Dumbo mode: ${g.reason}`);
    return false;
  }
  useMedia.setState({ dumboBlocked: false });
  ui.update({ dumbo: true });
  useUi.getState().closeDialog();
  return true;
}

/** Started once: re-check after the file list changes, the show is opened/saved, or the folder changes. */
export function startMediaChecks() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fileKey = () => cuesWithFiles().map((c) => c.file).join("|");
  let lastKey = "";
  useDoc.subscribe((s, prev) => {
    if (s.path !== prev.path) {
      void watchShowFolder();
      void checkFiles();
      lastKey = fileKey();
      return;
    }
    if (s.show === prev.show) return;
    const key = fileKey();
    if (key === lastKey) return;
    lastKey = key;
    clearTimeout(timer);
    timer = setTimeout(() => void checkFiles(), 400);
  });
  lastKey = fileKey();
  void checkFiles();
}
