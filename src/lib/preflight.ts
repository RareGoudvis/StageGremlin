// The Preflight checklist: automatic checks the app can work out itself,
// plus tick boxes for things only a person can check.

import { useDoc } from "../store";
import { useEngine } from "../engineStore";
import { allCues } from "../types";

export interface Check {
  key: string;
  title: string;
  detail: string;
  ok: boolean;
  kind: "auto" | "manual";
}

export const MANUAL_CHECKS: { key: string; title: string; detail: string }[] = [
  { key: "power", title: "Laptop on mains power", detail: "Battery mode can slow the laptop down during a long show." },
  { key: "desk", title: "Desk channel up and unmuted", detail: "Fader at unity, mute off, routed to the main mix." },
  { key: "cal", title: "Desk calibrated", detail: "USB channel gain set so a −14 LUFS cue reads 0 at unity fader." },
  { key: "sleep", title: "Laptop sleep and notifications off", detail: "Windows sleep, screen saver and Focus assist checked." },
  {
    key: "drillUsb", title: "Drill: USB dropout",
    detail: "Start a cue, then pull the Qu-24's USB cable. The app keeps playing on the laptop output and shows a red banner; plug it back in and it switches back by itself.",
  },
  {
    key: "drillCrash", title: "Drill: crash and resume",
    detail: "In Run, start a cue, then end the app in Task Manager. Reopen it: it offers to resume that cue where it was.",
  },
];

export function usePreflight(): { checks: Check[]; passed: number; allOk: boolean } {
  const show = useDoc((s) => s.show);
  const saved = useDoc((s) => s.show === s.savedShow && s.path !== null);
  const analysis = useDoc((s) => s.analysis);
  const manual = useDoc((s) => s.manualChecks);
  const output = useEngine((s) => s.output);

  const cues = allCues(show);
  const busy = cues.filter((c) => analysis[c.id]?.state === "busy").length;
  const failed = cues.filter((c) => analysis[c.id]?.state === "error");
  const noLoudness = cues.filter((c) => !c.loudness && analysis[c.id]?.state !== "busy");

  const checks: Check[] = [
    {
      key: "output", kind: "auto",
      title: output?.outputFound ? `Output: ${output.outputName}` : output ? "Chosen output not found" : "Output: waiting for the engine",
      detail: output?.outputFound
        ? output.preferred ? "The chosen output device is connected." : "Playing on the Windows default output. Pick the Qu-24 below if it should go to the desk."
        : output ? `${output.preferred ?? "The chosen device"} is missing; playing on ${output.outputName}.` : "No output status received yet.",
      ok: !!output?.outputFound,
    },
    {
      key: "cues", kind: "auto",
      title: cues.length ? `${cues.length} cue${cues.length > 1 ? "s" : ""} in the show` : "The show has no cues",
      detail: cues.length ? `${show.sections.length} section${show.sections.length > 1 ? "s" : ""}.` : "Import audio in Build first.",
      ok: cues.length > 0,
    },
    {
      key: "files", kind: "auto",
      title: failed.length ? `${failed.length} file${failed.length > 1 ? "s" : ""} could not be read` : "All cue files can be read",
      detail: failed.length ? failed.map((c) => `${c.number} ${c.name}`).join(", ") : "Every cue's audio file opened during analysis.",
      ok: failed.length === 0,
    },
    {
      key: "loudness", kind: "auto",
      title: busy ? `Analysing ${busy} file${busy > 1 ? "s" : ""}…` : noLoudness.length ? `${noLoudness.length} cue${noLoudness.length > 1 ? "s" : ""} not analysed` : "Loudness measured for every cue",
      detail: noLoudness.length ? "Unanalysed cues play without loudness matching." : `All cues matched to ${show.settings.targetLufs} LUFS (peak cap ${show.settings.peakCeilingDb} dBTP).`,
      ok: busy === 0 && noLoudness.length === 0,
    },
    {
      key: "saved", kind: "auto",
      title: saved ? "Show saved" : "Show has unsaved changes",
      detail: saved ? "The show file and its media folder are up to date." : "Save (Ctrl+S) so a crash can't lose your work.",
      ok: saved,
    },
    ...MANUAL_CHECKS.map((m) => ({ ...m, kind: "manual" as const, ok: !!manual[m.key] })),
  ];
  const passed = checks.filter((c) => c.ok).length;
  return { checks, passed, allOk: passed === checks.length };
}
