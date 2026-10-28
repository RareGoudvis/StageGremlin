// Inspector › Timing: when the cue starts and stops, and how it plays with the rest of the show.

import type { Cue, Exclusive, Pad } from "../../../types";
import { fmtTime } from "../../../lib/format";
import { trimmedLen } from "../../../types";
import { useT } from "../../../i18n";
import { Chips, Group, NumField, Row } from "../../controls";
import type { SetCue } from "./types";

export function TimingTab({ cue, pad, set, parents, hasChildren }: { cue: Cue; pad?: Pad; set: SetCue; parents: Cue[]; hasChildren: boolean }) {
  const t = useT();
  const len = trimmedLen(cue);
  return (
    <>
      <Group title={t("i.startStop")} right={<span className="mono" style={{ fontSize: 12, color: "var(--dim)" }}>{len != null ? t("i.plays", { len: fmtTime(len) }) : ""}</span>}>
        {!pad && <Row label={t("i.preWait")} hint={t("i.preWaitHint")}><NumField label={t("i.preWait")} unit="s" value={cue.preWait} min={0} onChange={(v) => set({ preWait: v })} /></Row>}
        <Row label={t("i.trimIn")}>
          <NumField label={t("i.trimIn")} unit="s" value={cue.trimIn} min={0} onChange={(v) => set({ trimIn: v })} />
        </Row>
        <Row label={t("i.trimOut")} hint={t("i.trimOutHint")}>
          <NumField label={t("i.trimOut")} unit="s" value={cue.trimOut ?? cue.loudness?.duration ?? 0} min={0} onChange={(v) => set({ trimOut: cue.loudness && v >= cue.loudness.duration ? null : v })} />
          <button className="b chip" aria-pressed={cue.trimOut === null} onClick={() => set({ trimOut: null })}>{t("i.toEnd")}</button>
        </Row>
        {!pad && (
          <Row label={t("i.playsLabel")} stack>
            <Chips fill label={t("i.playsLabel")} value={cue.playCount} onChange={(playCount) => set({ playCount })}
              options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: `${n}×` })).concat([{ value: 0, label: t("i.loop") }])} />
          </Row>
        )}
        <Row label={t("i.stopFade")} hint={t("i.stopFadeHint")}><NumField label={t("i.stopFade")} unit="s" value={cue.stopFade} min={0} onChange={(v) => set({ stopFade: v })} /></Row>
        <Row label={t("i.curve")} stack>
          <Chips<Cue["curve"]> fill label={t("i.curve")} value={cue.curve} onChange={(curve) => set({ curve })}
            options={[{ value: "linear", label: t("i.curve.linear") }, { value: "sCurve", label: t("i.curve.s") }, { value: "exponential", label: t("i.curve.exp") }]} />
        </Row>
      </Group>

      <Group title={t("i.withShow")}>
        {!pad && (
          <Row label={t("i.attach")} hint={t("i.attachHint")}>
            <select
              className="select" aria-label={t("i.attach")} value={cue.attach?.to ?? ""} disabled={hasChildren}
              title={hasChildren ? t("i.attachHasChildren") : undefined}
              onChange={(e) => set({ attach: e.target.value ? { to: e.target.value, at: cue.attach?.at ?? 0 } : null })}
              style={{ flex: 1, minWidth: 0 }}
            >
              <option value="">{t("i.attachNone")}</option>
              {parents.map((p) => <option key={p.id} value={p.id}>{p.number} {p.name}</option>)}
            </select>
            {cue.attach && <NumField label={t("i.attachAt")} unit={t("i.attachAtUnit")} value={cue.attach.at} min={0} onChange={(at) => set({ attach: { to: cue.attach!.to, at } })} />}
          </Row>
        )}
        {!pad && !cue.attach && <ExclusiveRow exclusive={cue.exclusive} secs={cue.exclusiveSecs} onChange={(p) => set(p)} />}
        <Row label={t("i.background")} stack>
          <Chips<boolean> fill label={t("i.background")} value={cue.duckBg} onChange={(duckBg) => set({ duckBg })}
            options={[{ value: true, label: t("i.bg.ducks") }, { value: false, label: t("i.bg.leaves") }]} />
        </Row>
      </Group>
    </>
  );
}

/**
 * "When this starts": what happens to what is already playing. Also used by the multi-cue inspector
 * (`exclusive` undefined = the selected cues differ).
 */
export function ExclusiveRow({ exclusive, secs, onChange }: { exclusive: Exclusive | undefined; secs: number | undefined; onChange: (p: Partial<Cue>) => void }) {
  const t = useT();
  const hint: Record<Exclusive, string> = {
    off: t("i.excl.offHint"), stop: t("i.excl.stopHint"), fade: t("i.excl.fadeHint"), crossfade: t("i.excl.crossHint"),
  };
  return (
    <Row label={t("i.excl")} stack>
      <Chips<Exclusive | "">
        fill label={t("i.excl")} value={exclusive ?? ""} onChange={(v) => v && onChange({ exclusive: v })}
        options={[
          { value: "off", label: t("i.excl.off") },
          { value: "stop", label: t("i.excl.stop") },
          { value: "fade", label: t("i.excl.fade") },
          { value: "crossfade", label: t("i.excl.cross") },
        ]} />
      {exclusive && <span style={{ fontSize: 12.5, color: "var(--mute)", lineHeight: 1.4, flex: "1 1 100%" }}>{hint[exclusive]}</span>}
      {(exclusive === "fade" || exclusive === "crossfade") && (
        <NumField label={t("i.excl.secs")} unit={t("i.excl.secsUnit")} value={secs ?? 2} min={0.1} max={30} onChange={(v) => onChange({ exclusiveSecs: v })} />
      )}
    </Row>
  );
}
