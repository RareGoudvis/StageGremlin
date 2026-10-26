import type { Cue } from "../../../types";

/** Change one cue. `key` merges rapid changes (typing, dragging a slider) into one undo step. */
export type SetCue = (patch: Partial<Cue>, key?: string) => void;
