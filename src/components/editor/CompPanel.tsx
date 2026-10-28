// Compressor: on/off, presets and a transfer curve (input level → output level).

import type { Compressor, Cue } from "../../types";
import { COMP_PRESETS, matchCompPreset } from "../../lib/presets";
import { compOut } from "../../lib/dspMath";
import { NumField, Row } from "../controls";
import { compPresetName } from "../../lib/labels";
import { useT } from "../../i18n";

const S = 150;           // curve box size
const LO = -60;          // dB at the bottom-left corner

const pos = (db: number) => ((db - LO) / -LO) * S;

export function CompPanel({ cue, set }: { cue: Cue; set: (patch: Partial<Cue>, key?: string) => void }) {
  const t = useT();
  const c = cue.comp;
  const preset = matchCompPreset(c);
  const setComp = (patch: Partial<Compressor>, key?: string) => set({ comp: { ...c, ...patch } }, key);

  const pts: string[] = [];
  for (let d = LO; d <= 0; d += 1) pts.push(`${pos(d)},${S - pos(Math.min(6, compOut(c, d)))}`);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="k" style={{ marginRight: "auto" }}>{t("b.compressor")}</span>
        <button className="b chip" aria-pressed={c.on} onClick={() => setComp({ on: !c.on })}>{c.on ? t("sched.on") : t("b.comp.bypassed")}</button>
      </div>
      <div role="group" aria-label={t("b.comp.presets")} className="chips">
        {COMP_PRESETS.map((p) => (
          <button key={p.name} className="b chip" aria-pressed={c.on && preset === p.name} title={`${p.comp.thresholdDb} dB, ${p.comp.ratio}:1`}
            onClick={() => set({ comp: { on: true, ...p.comp } })}>{compPresetName(t, p.name)}</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <svg viewBox={`0 0 ${S} ${S}`} role="img" aria-label={t("b.comp.curve")} style={{ width: S, height: S, flex: "none", background: "var(--p1)", borderRadius: 10, border: "1px solid var(--line)", opacity: c.on ? 1 : 0.5 }}>
          <line x1={0} y1={S} x2={S} y2={0} stroke="var(--line)" strokeDasharray="3 4" />
          <line x1={pos(c.thresholdDb)} x2={pos(c.thresholdDb)} y1={0} y2={S} stroke="var(--amb)" strokeWidth={1} strokeDasharray="2 3" />
          <polyline points={pts.join(" ")} fill="none" stroke="var(--acc)" strokeWidth={2.4} />
          <text x={4} y={12} fontSize={9} fill="var(--mute)" fontFamily="IBM Plex Mono, monospace">{t("b.comp.out")}</text>
          <text x={S - 18} y={S - 4} fontSize={9} fill="var(--mute)" fontFamily="IBM Plex Mono, monospace">{t("b.comp.in")}</text>
        </svg>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
          <Row label={t("b.comp.threshold")}><NumField label={t("b.comp.threshold")} unit="dB" value={c.thresholdDb} min={-60} max={0} step={1} digits={0} onChange={(v) => setComp({ thresholdDb: v })} /></Row>
          <Row label={t("b.comp.ratio")}><NumField label={t("b.comp.ratio")} unit=": 1" value={c.ratio} min={1} max={20} step={0.5} onChange={(v) => setComp({ ratio: v })} /></Row>
          <Row label={t("b.comp.attack")}><NumField label={t("b.comp.attack")} unit="ms" value={c.attackMs} min={0.1} max={200} step={1} digits={0} onChange={(v) => setComp({ attackMs: v })} /></Row>
          <Row label={t("b.comp.release")}><NumField label={t("b.comp.release")} unit="ms" value={c.releaseMs} min={10} max={2000} step={10} digits={0} onChange={(v) => setComp({ releaseMs: v })} /></Row>
          <Row label={t("b.comp.makeup")}><NumField label={t("b.comp.makeupGain")} unit="dB" value={c.makeupDb} min={0} max={18} step={0.5} onChange={(v) => setComp({ makeupDb: v })} /></Row>
        </div>
      </div>
    </div>
  );
}
