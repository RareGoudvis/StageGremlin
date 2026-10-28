// 4-band EQ with a live response curve. Drag a band's dot: left/right = frequency, up/down = gain.

import { useRef, useState, type PointerEvent } from "react";
import type { Cue, EqBand } from "../../types";
import { EQ_PRESETS, matchEqPreset } from "../../lib/presets";
import { eqResponseDb, freqToX, xToFreq } from "../../lib/dspMath";
import { fmtDb } from "../../lib/format";
import { Chips, NumField } from "../controls";
import { eqPresetName, eqPresetTip } from "../../lib/labels";
import { useT, type TKey } from "../../i18n";

const W = 480;
const H = 170;
const RANGE_DB = 15;
/** Text keys, translated at render time. */
const BAND_NAMES: TKey[] = ["b.eq.low", "b.eq.lowMid", "b.eq.highMid", "b.eq.high"];
/** Each band stays in its own part of the spectrum so the dots never swap places. */
const BAND_LIMITS: [number, number][] = [[30, 400], [120, 2000], [800, 8000], [2500, 16000]];
const BAND_COLORS = ["var(--st)", "var(--acc)", "var(--amb)", "var(--lx)"];

const yOf = (db: number) => H / 2 - (db / RANGE_DB) * (H / 2 - 8);
const dbOf = (y: number) => ((H / 2 - y) / (H / 2 - 8)) * RANGE_DB;

export function EqPanel({ cue, set }: { cue: Cue; set: (patch: Partial<Cue>, key?: string) => void }) {
  const t = useT();
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ i: number; id: number } | null>(null);
  const preset = matchEqPreset(cue.eq.map((b) => b.gainDb));

  const setBand = (i: number, patch: Partial<EqBand>, key?: string) =>
    set({ eq: cue.eq.map((b, j) => (j === i ? { ...b, ...patch } : b)) as Cue["eq"] }, key);

  // The response curve, sampled every 3 px.
  const pts: string[] = [];
  for (let x = 0; x <= W; x += 3) pts.push(`${x},${yOf(Math.max(-RANGE_DB, Math.min(RANGE_DB, eqResponseDb(cue.eq, cue.hpf, xToFreq(x, W)))))}`);

  const onMove = (e: PointerEvent) => {
    if (!drag || !svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const y = ((e.clientY - r.top) / r.height) * H;
    const [lo, hi] = BAND_LIMITS[drag.i];
    const freq = Math.round(Math.max(lo, Math.min(hi, xToFreq(x, W))));
    const gainDb = Math.round(Math.max(-12, Math.min(12, dbOf(y))) * 2) / 2;
    setBand(drag.i, { freq, gainDb, on: true }, `eq-drag-${drag.id}`);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="k" style={{ marginRight: "auto" }}>{t("b.eq.title")}</span>
        <Chips label={t("b.highPass")} value={cue.hpf ?? 0} onChange={(v) => set({ hpf: v === 0 ? null : v })}
          options={[{ value: 0, label: t("b.eq.hpOff") }, { value: 60, label: "60" }, { value: 80, label: "80" }, { value: 120, label: "120 Hz" }]} />
      </div>
      <div role="group" aria-label={t("b.eq.presets")} className="chips">
        {EQ_PRESETS.map((p) => (
          <button key={p.name} className="b chip" title={eqPresetTip(t, p.name, p.tip)} aria-pressed={preset?.name === p.name}
            onClick={() => set({ eq: cue.eq.map((b, i) => ({ ...b, gainDb: p.gains[i], on: true })) as Cue["eq"], ...(p.hpf !== undefined ? { hpf: p.hpf } : {}) })}>
            {eqPresetName(t, p.name)}
          </button>
        ))}
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={t("b.eq.curve")}
        onPointerMove={onMove}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
        style={{ width: "100%", height: H, background: "var(--p1)", borderRadius: 10, border: "1px solid var(--line)", touchAction: "none" }}
      >
        {[100, 1000, 10000].map((f) => <line key={f} x1={freqToX(f, W)} x2={freqToX(f, W)} y1={0} y2={H} stroke="var(--line)" strokeWidth={1} />)}
        {[-12, -6, 6, 12].map((d) => <line key={d} x1={0} x2={W} y1={yOf(d)} y2={yOf(d)} stroke="var(--line)" strokeWidth={0.5} strokeDasharray="3 4" />)}
        <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="var(--line)" strokeWidth={1} />
        <polyline points={pts.join(" ")} fill="none" stroke="var(--acc)" strokeWidth={2.4} strokeLinejoin="round" />
        {cue.eq.map((b, i) => (
          <circle
            key={i}
            cx={freqToX(b.freq, W)}
            cy={yOf(b.on ? b.gainDb : 0)}
            r={8}
            fill={b.on ? "var(--bg)" : "var(--p3)"}
            stroke={BAND_COLORS[i]}
            strokeWidth={2.5}
            style={{ cursor: "grab" }}
            onPointerDown={(e) => {
              (e.target as Element).setPointerCapture?.(e.pointerId);
              svgRef.current?.setPointerCapture(e.pointerId);
              setDrag({ i, id: Date.now() });
            }}
          >
            <title>{t(BAND_NAMES[i])}: {Math.round(b.freq)} Hz, {fmtDb(b.gainDb)}</title>
          </circle>
        ))}
        {[["20", 20], ["100", 100], ["1k", 1000], ["10k", 10000]].map(([l, f]) => (
          <text key={l} x={freqToX(f as number, W) + 3} y={H - 5} fontSize={10} fill="var(--mute)" fontFamily="IBM Plex Mono, monospace">{l}</text>
        ))}
      </svg>
      {cue.eq.map((b, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "24px 70px 100px minmax(0, 1fr) 76px", gap: 8, alignItems: "center" }}>
          <button className="b" aria-pressed={b.on} aria-label={t("b.eq.bandOnOff", { band: t(BAND_NAMES[i]) })} onClick={() => setBand(i, { on: !b.on })}
            style={{ width: 18, height: 18, borderRadius: 9, background: b.on ? BAND_COLORS[i] : "var(--p3)", border: `2px solid ${BAND_COLORS[i]}`, padding: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 700 }}>{t(BAND_NAMES[i])}</span>
          <NumField label={t("b.eq.freq", { band: t(BAND_NAMES[i]) })} value={b.freq} unit="Hz" digits={0} step={10} min={BAND_LIMITS[i][0]} max={BAND_LIMITS[i][1]} width={64} onChange={(freq) => setBand(i, { freq })} />
          <input type="range" aria-label={t("b.eq.gain", { band: t(BAND_NAMES[i]) })} min={-12} max={12} step={0.5} value={b.gainDb} onChange={(e) => setBand(i, { gainDb: Number(e.target.value) }, `eq-g${i}`)} onDoubleClick={() => setBand(i, { gainDb: 0 })} />
          <span className="mono" style={{ fontSize: 12.5, textAlign: "right" }}>{fmtDb(b.gainDb)}</span>
        </div>
      ))}
    </div>
  );
}
