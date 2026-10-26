// Headphone preview: plays a cue on the second output (never through the show master).
// The shell reports progress on preview://state; we keep the latest in a tiny store.

import { create } from "zustand";
import type { Cue } from "../types";
import type { PreviewState } from "../types";
import { useDoc } from "../store";
import { useEngine } from "../engineStore";
import { call, dirname } from "./tauri";
import { toast } from "../uiStore";

interface PreviewStore {
  state: PreviewState | null;
  /** Which cue we asked to preview (the event only carries a name). */
  cueId: string | null;
  set: (s: PreviewState) => void;
}

export const usePreview = create<PreviewStore>((set) => ({
  state: null,
  cueId: null,
  set: (state) => set((old) => ({ state, cueId: state.playing ? old.cueId : null })),
}));

export async function previewPlay(cue: Cue, at = 0) {
  try {
    usePreview.setState({ cueId: cue.id });
    await call("preview_play", { cue, baseDir: dirname(useDoc.getState().path), at });
    // Replacing a running preview may first report "stopped", which clears cueId: set it again.
    usePreview.setState({ cueId: cue.id });
  } catch (e) {
    toast(`Preview failed: ${e}`);
  }
}

export async function previewStop() {
  usePreview.setState({ cueId: null });
  try {
    await call("preview_stop");
  } catch {
    // Nothing playing, or no preview device: either way it's stopped.
  }
}

/** H: start previewing this cue, or stop if it is already previewing. */
export function previewToggle(cue: Cue, at = 0) {
  const p = usePreview.getState();
  if (p.state?.playing && p.cueId === cue.id) void previewStop();
  else void previewPlay(cue, at);
}

/**
 * True when the preview would come out of the hall speakers: the preview device
 * is the same as the show output. Shown as a warning chip next to preview buttons.
 */
export function usePreviewInHall(): boolean {
  const pv = usePreview((s) => s.state?.outputName);
  const out = useEngine((s) => s.output?.outputName);
  return !!pv && !!out && pv === out;
}
