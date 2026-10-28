// Can the show go into Run (or Dumbo mode)? Only when the file check has FINISHED for the
// show as it is now, and every cue and pad file is on disk and readable.
//
// Review #4: before this, Run was only blocked by files KNOWN to be missing, so a check that
// hadn't finished, had failed, or a file that exists but can't be decoded, still let you in.
// Pure function, so it can be tested without the app around it.

import { tr } from "../i18n";

export type CheckState = "idle" | "checking" | "ok" | "failed";

export interface GateInput {
  /** State of the last file check. */
  checkState: CheckState;
  /** Error text when the check itself failed. */
  checkError?: string;
  /** Did the last check cover the show's files as they are NOW (same cues, same files)? */
  checkedCurrent: boolean;
  /** Cue and pad ids whose file is not on disk. */
  missing: string[];
  /** Cue and pad ids whose file is there but could not be decoded/analysed. */
  unreadable: string[];
  /** Cue and pad ids still being analysed. */
  analysing: string[];
}

export interface GateResult {
  ok: boolean;
  /** Short reason, for a toast and the Preflight row. */
  reason: string;
}

export function runGate(i: GateInput): GateResult {
  if (i.checkState === "failed") return { ok: false, reason: tr("r.gate.failed", { e: i.checkError || tr("r.gate.unknown") }) };
  if (i.checkState !== "ok" || !i.checkedCurrent) return { ok: false, reason: tr("r.gate.checking") };
  if (i.missing.length) return { ok: false, reason: i.missing.length > 1 ? tr("r.gate.missingN", { n: i.missing.length }) : tr("r.gate.missing1") };
  if (i.unreadable.length) return { ok: false, reason: i.unreadable.length > 1 ? tr("r.gate.unreadableN", { n: i.unreadable.length }) : tr("r.gate.unreadable1") };
  if (i.analysing.length) return { ok: false, reason: i.analysing.length > 1 ? tr("r.gate.analysingN", { n: i.analysing.length }) : tr("r.gate.analysing1") };
  return { ok: true, reason: tr("r.gate.ok") };
}

/** A fingerprint of which files the show uses, so a check result can be matched to the show it was made for. */
export function filesSignature(cues: { id: string; file: string }[]): string {
  return cues.map((c) => `${c.id}=${c.file}`).sort().join("\n");
}
