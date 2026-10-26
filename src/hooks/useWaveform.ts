import { useSyncExternalStore } from "react";
import { getWaveform, onWaveformsChanged } from "../lib/fileActions";

/** The waveform overview for a file; re-renders when it arrives from analysis. */
export function useWaveform(file: string): number[] | undefined {
  return useSyncExternalStore(onWaveformsChanged, () => getWaveform(file));
}
