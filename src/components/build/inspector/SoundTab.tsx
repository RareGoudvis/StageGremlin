// Inspector › Sound: the quick versions of the tone controls (presets), pan and the Under level.
// The cue editor (Enter) has the full EQ and compressor curves.

import type { Cue, Pad, ShowSettings } from "../../../types";
import { COMP_PRESETS, EQ_PRESETS, matchCompPreset, matchEqPreset } from "../../../lib/presets";
import { Chips, Group, NumField, Row, Slider } from "../../controls";
import type { SetCue } from "./types";
import { compPresetName, eqPresetName, eqPresetTip } from "../../../lib/labels";
import { useT } from "../../../i18n";

export function SoundTab({ cue, pad, set, settings }: { cue: Cue; pad?: Pad; set: SetCue; settings: ShowSettings }) {
  const t = useT();
  const eqPreset = matchEqPreset(cue.eq.map((b) => b.gainDb));
  const compPreset = matchCompPreset(cue.comp);
  return (
    <>
      <p style={{ margin: 0, fontSize: 13, color: "var(--dim)", lineHeight: 1.5 }}>
        {t("b.sound.intro")}
      </p>
      <Group title={t("b.sound.tone")}>
        <Row label={t("b.highPass")}>
          <Chips label={t("b.highPass")} value={cue.hpf ?? 0} onChange={(v) => set({ hpf: v === 0 ? null : v })}
            options={[{ value: 0, label: t("sched.off") }, { value: 60, label: "60 Hz" }, { value: 80, label: "80 Hz" }, { value: 120, label: "120 Hz" }]} />
        </Row>
        <Row label={t("b.sound.eqPreset")}>
          <select
            className="select" aria-label={t("b.sound.eqPreset")} value={eqPreset?.name ?? ""} style={{ flex: 1 }}
            onChange={(e) => {
              const p = EQ_PRESETS.find((x) => x.name === e.target.value);
              if (!p) return;
              set({ eq: cue.eq.map((b, i) => ({ ...b, gainDb: p.gains[i] })) as Cue["eq"], ...(p.hpf !== undefined ? { hpf: p.hpf } : {}) });
            }}
          >
            {!eqPreset && <option value="">{t("b.sound.custom")}</option>}
            {EQ_PRESETS.map((p) => <option key={p.name} value={p.name} title={eqPresetTip(t, p.name, p.tip)}>{eqPresetName(t, p.name)}</option>)}
          </select>
        </Row>
        {eqPreset && eqPreset.name !== "Flat" && <span style={{ fontSize: 12, color: "var(--mute)" }}>{eqPresetTip(t, eqPreset.name, eqPreset.tip)}</span>}
        <Row label={t("b.compressor")}>
          <button className="b chip" aria-pressed={cue.comp.on} onClick={() => set({ comp: { ...cue.comp, on: !cue.comp.on } })}>{cue.comp.on ? t("sched.on") : t("sched.off")}</button>
          <Chips label={t("b.sound.compPreset")} value={cue.comp.on ? compPreset : null}
            onChange={(name) => {
              const p = COMP_PRESETS.find((x) => x.name === name);
              if (p) set({ comp: { on: true, ...p.comp } });
            }}
            options={COMP_PRESETS.map((p) => ({ value: p.name as string | null, label: compPresetName(t, p.name), title: `${p.comp.thresholdDb} dB, ${p.comp.ratio}:1` }))} />
        </Row>
      </Group>
      <Group title={t("b.sound.placement")}>
        <Row label={t("b.pan")}>
          <Slider label={t("b.pan")} min={-1} max={1} step={0.05} value={cue.pan} format={(v) => (Math.abs(v) < 0.01 ? "C" : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)} onChange={(v) => set({ pan: v }, "pan")} />
        </Row>
        {!pad && (
          <Row label={t("b.sound.under")} hint={t("b.sound.underHint")}>
            <button className="b chip" aria-pressed={cue.underDb === null} onClick={() => set({ underDb: null })}>{t("b.sound.showDefault", { n: settings.underDb })}</button>
            <button className="b chip" aria-pressed={cue.underDb !== null} onClick={() => set({ underDb: cue.underDb ?? settings.underDb })}>{t("b.sound.own")}</button>
            {cue.underDb !== null && <NumField label={t("b.sound.underLevel")} unit="dB" value={cue.underDb} max={0} min={-40} step={1} digits={0} onChange={(v) => set({ underDb: v })} />}
          </Row>
        )}
      </Group>
    </>
  );
}
