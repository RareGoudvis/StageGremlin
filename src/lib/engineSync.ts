// Keeps the engine's copy of the show in step with the editor, and feeds engine
// events into engineStore. Started once from main.tsx.

import { useDoc } from "../store";
import { useEngine } from "../engineStore";
import { call, dirname, on } from "./tauri";
import { usePreview } from "./preview";
import { useTools } from "./tools";
import { useYt } from "./youtube";
import { checkFiles, startMediaChecks } from "./media";

const DEBOUNCE_MS = 150;
let timer: ReturnType<typeof setTimeout> | undefined;
let lastSent: unknown = null;

async function send() {
  clearTimeout(timer);
  timer = undefined;
  const { show, path } = useDoc.getState();
  if (show === lastSent) return;
  lastSent = show;
  try {
    await call("engine_set_show", { show, baseDir: dirname(path) });
  } catch (e) {
    useEngine.getState().setError(String(e));
  }
}

/** Send the show right now (e.g. before setting the playhead to a cue that just moved). */
export function flushShowToEngine(): Promise<void> {
  return send();
}

export function startEngineSync() {
  // After every document change, wait ~150 ms of quiet, then send the whole show.
  useDoc.subscribe((s, prev) => {
    if (s.show === prev.show && s.path === prev.path) return;
    clearTimeout(timer);
    timer = setTimeout(send, DEBOUNCE_MS);
  });
  void send();

  const engine = useEngine.getState();
  void on("engine://state", (st) => engine.receive(st));
  void on("engine://error", (e) => engine.setError(e));
  void on("engine://output", (o) => engine.setOutput(o));
  void on("preview://state", (p) => usePreview.getState().set(p));
  void on("yt://install", (p) => useTools.getState().onProgress(p));
  void on("yt://progress", (p) => useYt.getState().onProgress(p));
  void on("media://changed", () => void checkFiles());
  startMediaChecks();
  // The first engine://output event may fire before we listen, so also ask once.
  call("audio_output_status").then(engine.setOutput, (e) => console.warn("[cueplay] audio_output_status", e));
}
