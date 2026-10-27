// Keeps the core's guard in step with Settings › AUDAC (and with Run), and tells the operator
// when someone else changed a zone. Both hooks run once, from App.

import { useEffect, useRef } from "react";
import { useDoc } from "../store";
import { useSettings } from "../settingsStore";
import { useUi } from "../uiStore";
import { translate, type TKey } from "../i18n";
import { audac, useAudac } from "./audac";
import { describeChange, guardRules, type GuardRule } from "./audacGroups";
import { useScheduleRunning } from "./audacSchedule";

/** Tell the core how each zone is protected, whenever Guard, Run or the running schedule changes (and after reconnecting). */
export function useAudacGuardSync() {
  const guard = useSettings((s) => s.ui.audac.guard);
  const inRun = useDoc((s) => s.mode === "run");
  const running = useScheduleRunning((s) => s.running);
  const connected = useAudac()?.status === "connected";
  const rules = guardRules(guard ?? { zones: [], when: "off" }, inRun, running);
  const key = JSON.stringify(rules);
  useEffect(() => {
    audac.setGuard(JSON.parse(key)).catch(() => {});
  }, [key, connected]);
}

/** The same rules, for showing per zone in the panel ("Hold", "≤ −30 dB"). */
export function useGuardRules(): GuardRule[] {
  const guard = useSettings((s) => s.ui.audac.guard);
  const inRun = useDoc((s) => s.mode === "run");
  const running = useScheduleRunning((s) => s.running);
  return guardRules(guard ?? { zones: [], when: "off" }, inRun, running);
}

/** One toast per new change by someone else, e.g. "09:31 · Podium: input Line 3 → Aux (put back)". */
export function useAudacChangeToasts() {
  const changes = useAudac()?.changes;
  const lastId = useRef<number | null>(null);
  useEffect(() => {
    if (!changes?.length) return;
    const newest = changes[changes.length - 1];
    // The first list we see after starting is old news.
    if (lastId.current === null) {
      lastId.current = newest.id;
      return;
    }
    const fresh = changes.filter((c) => c.id > lastId.current!);
    lastId.current = newest.id;
    if (fresh.length) useUi.getState().showToast(changeText(fresh[fresh.length - 1]));
  }, [changes]);
}

/** A change in the operator's words and language. */
export function changeText(c: Parameters<typeof describeChange>[0]): string {
  const ui = useSettings.getState().ui;
  const t = (k: TKey) => translate(ui.lang, k);
  return `${t("audac.someoneElse")} ${describeChange(
    c,
    (n) => ui.audac.zones[n - 1]?.name || `Zone ${n}`,
    (n) => ui.audac.inputs[n - 1]?.name || `${n}`,
    { volume: t("audac.wVolume"), input: t("audac.wInput"), mute: t("audac.mute"), on: t("audac.wOn"), off: t("audac.wOff"), putBack: t("audac.putBack") },
  )}`;
}
