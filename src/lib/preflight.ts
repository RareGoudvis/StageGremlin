// The Preflight checklist: automatic checks the app can work out itself,
// plus tick boxes for things only a person can check.

import { useDoc } from "../store";
import { useEngine } from "../engineStore";
import { currentGate, useMedia } from "./media";
import { useBgRouting } from "./bgRouting";
import { allCues } from "../types";
import { useT, type TKey } from "../i18n";

export interface Check {
  key: string;
  title: string;
  detail: string;
  ok: boolean;
  kind: "auto" | "manual";
  /** For the missing-files check: the first cue to Locate. */
  fixId?: string;
}

/** The tick boxes. Title and detail are text keys (r.chk.<key> and r.chk.<key>D), translated when shown. */
export const MANUAL_CHECKS: { key: string; title: TKey; detail: TKey }[] = [
  { key: "power", title: "r.chk.power", detail: "r.chk.powerD" },
  { key: "desk", title: "r.chk.desk", detail: "r.chk.deskD" },
  { key: "cal", title: "r.chk.cal", detail: "r.chk.calD" },
  { key: "sleep", title: "r.chk.sleep", detail: "r.chk.sleepD" },
  { key: "drillUsb", title: "r.chk.drillUsb", detail: "r.chk.drillUsbD" },
  { key: "drillCrash", title: "r.chk.drillCrash", detail: "r.chk.drillCrashD" },
];

export function usePreflight(): { checks: Check[]; passed: number; allOk: boolean } {
  const show = useDoc((s) => s.show);
  const saved = useDoc((s) => s.show === s.savedShow && s.path !== null);
  const analysis = useDoc((s) => s.analysis);
  const manual = useDoc((s) => s.manualChecks);
  const output = useEngine((s) => s.output);
  const outputLost = useEngine((s) => s.outputLost);
  const missingMap = useMedia((s) => s.missing);
  const t = useT();

  const cues = allCues(show);
  const missing = [...cues, ...show.pads.map((p) => p.cue)].filter((c) => missingMap[c.id]);
  const withPads = [...cues, ...show.pads.map((p) => p.cue)];
  const busy = withPads.filter((c) => analysis[c.id]?.state === "busy").length;
  const failed = withPads.filter((c) => analysis[c.id]?.state === "error");
  const noLoudness = cues.filter((c) => !c.loudness && analysis[c.id]?.state !== "busy");

  // Re-render when the check state changes; the gate itself reads the stores.
  useMedia((s) => `${s.checkState}|${s.checkedSignature}|${s.checkError}`);
  const gate = currentGate();
  const routing = useBgRouting();
  const checkState = useMedia.getState().checkState;

  const checks: Check[] = [
    {
      key: "verify", kind: "auto",
      title: gate.ok ? t("r.chk.verifyOk") : checkState === "checking" ? t("r.chk.verifyBusy") : checkState === "failed" ? t("r.chk.verifyFailed") : t("r.chk.verifyBlocked"),
      detail: gate.reason,
      ok: gate.ok,
    },
    {
      key: "output", kind: "auto",
      title: output?.outputFound ? t("r.chk.output", { name: output.outputName }) : outputLost ? t("r.chk.outputLost") : output ? t("r.chk.output", { name: output.outputName }) : t("r.chk.outputWaiting"),
      detail: output?.outputFound
        ? output.preferred ? t("r.chk.outputOk") : t("r.chk.outputDefault")
        : outputLost ? t("r.chk.outputGone", { pref: output!.preferred ?? "", name: output!.outputName })
        : output ? t("r.chk.outputNotYet", { pref: output.preferred ?? t("r.chk.chosenDevice") }) : t("r.chk.noStatus"),
      // Not plugged in (yet) is fine; only a device that disappeared is a problem.
      ok: !!output && !outputLost,
    },
    {
      // Background music (WebView2) plays on the WINDOWS DEFAULT device, not on the show output.
      key: "bgRoute", kind: "auto",
      title: !routing.known ? t("r.chk.bgUnknown") : routing.same ? t("r.chk.bgSame", { name: routing.showName ?? "" }) : t("r.chk.bgOther", { name: routing.defaultName ?? t("r.chk.unknownDevice") }),
      detail: routing.same
        ? t("r.chk.bgSameD")
        : t("r.chk.bgOtherD", { show: routing.showName ?? t("r.chk.theShowOutput"), other: routing.defaultName ?? t("r.chk.anotherDevice") }),
      // Only blocks the green light when this show actually uses background music.
      ok: routing.same || !(show.background as { source?: string } | null | undefined)?.source,
    },
    {
      key: "cues", kind: "auto",
      title: cues.length ? (cues.length > 1 ? t("r.chk.cuesN", { n: cues.length }) : t("r.chk.cues1")) : t("r.chk.noCues"),
      detail: cues.length ? (show.sections.length > 1 ? t("r.chk.sectionsN", { n: show.sections.length }) : t("r.chk.sections1")) : t("r.chk.importFirst"),
      ok: cues.length > 0,
    },
    {
      key: "missing", kind: "auto",
      title: missing.length ? (missing.length > 1 ? t("r.chk.missingN", { n: missing.length }) : t("r.chk.missing1")) : t("r.chk.allOnDisk"),
      detail: missing.length ? missing.map((c) => `${c.number || t("r.chk.pad")} ${c.name} (${c.file})`).join(" · ") : t("r.chk.allOnDiskD"),
      ok: missing.length === 0,
      fixId: missing[0]?.id,
    },
    {
      key: "files", kind: "auto",
      title: failed.length ? (failed.length > 1 ? t("r.chk.unreadableN", { n: failed.length }) : t("r.chk.unreadable1")) : t("r.chk.readable"),
      detail: failed.length ? failed.map((c) => `${c.number} ${c.name}`).join(", ") : t("r.chk.readableD"),
      ok: failed.length === 0,
    },
    {
      key: "loudness", kind: "auto",
      title: busy ? (busy > 1 ? t("r.chk.analysingN", { n: busy }) : t("r.chk.analysing1")) : noLoudness.length ? (noLoudness.length > 1 ? t("r.chk.notAnalysedN", { n: noLoudness.length }) : t("r.chk.notAnalysed1")) : t("r.chk.loudnessOk"),
      detail: noLoudness.length ? t("r.chk.notAnalysedD") : t("r.chk.loudnessOkD", { lufs: show.settings.targetLufs, peak: show.settings.peakCeilingDb }),
      ok: busy === 0 && noLoudness.length === 0,
    },
    {
      key: "saved", kind: "auto",
      title: saved ? t("r.chk.saved") : t("r.chk.unsaved"),
      detail: saved ? t("r.chk.savedD") : t("r.chk.unsavedD"),
      ok: saved,
    },
    ...MANUAL_CHECKS.map((m) => ({ key: m.key, title: t(m.title), detail: t(m.detail), kind: "manual" as const, ok: !!manual[m.key] })),
  ];
  const passed = checks.filter((c) => c.ok).length;
  return { checks, passed, allOk: passed === checks.length };
}
