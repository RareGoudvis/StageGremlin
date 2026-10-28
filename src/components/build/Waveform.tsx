// Waveform strip in the inspector with draggable handles:
// IN / OUT trim at the bottom, fade-in / fade-out at the top corners of the kept part.
// All maths is in seconds; pixels only appear when converting the pointer position.

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import type { Cue } from "../../types";
import { fmtSecs, fmtTime } from "../../lib/format";
import { useT } from "../../i18n";

type Handle = "in" | "out" | "fadeIn" | "fadeOut";
const MIN_LEN = 0.5; // never trim a cue shorter than half a second
const H = 96;

export function Waveform({ cue, waveform, onChange }: {
  cue: Cue;
  waveform: number[] | undefined;
  /** `key` lets the store merge one drag into a single undo step. */
  onChange: (patch: Partial<Cue>, key: string) => void;
}) {
  const t = useT();
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<{ handle: Handle; id: number } | null>(null);

  const dur = cue.loudness?.duration ?? 0;
  const tIn = cue.trimIn;
  const tOut = Math.min(cue.trimOut ?? dur, dur);
  const x = (t: number) => (dur > 0 ? (t / dur) * width : 0);

  // Track the box width so the canvas is always sharp.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Draw the bars. Colours come from the theme tokens so both themes work.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !width) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(width * dpr);
    c.height = Math.round(H * dpr);
    const g = c.getContext("2d");
    if (!g) return;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, width, H);
    if (!waveform?.length) return;
    const css = getComputedStyle(c);
    const kept = css.getPropertyValue("--acc").trim() || "#C6F432";
    const cut = css.getPropertyValue("--wave").trim() || "#888";
    const bars = Math.max(1, Math.floor(width / 2));
    const mid = H / 2;
    for (let i = 0; i < bars; i++) {
      // Each bar shows the loudest point in its slice of the overview.
      const a = Math.floor((i / bars) * waveform.length);
      const b = Math.max(a + 1, Math.floor(((i + 1) / bars) * waveform.length));
      let peak = 0;
      for (let j = a; j < b; j++) peak = Math.max(peak, waveform[j] ?? 0);
      const t = ((i + 0.5) / bars) * dur;
      g.fillStyle = t >= tIn && t <= tOut ? kept : cut;
      const h = Math.max(1, peak * (H - 8));
      g.fillRect(i * 2, mid - h / 2, 1.4, h);
    }
  }, [waveform, width, dur, tIn, tOut]);

  const startDrag = (handle: Handle) => (e: PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ handle, id: Date.now() });
  };

  const onMove = (e: PointerEvent) => {
    if (!drag || !boxRef.current || dur <= 0) return;
    const r = boxRef.current.getBoundingClientRect();
    const t = Math.max(0, Math.min(dur, ((e.clientX - r.left) / r.width) * dur));
    const round = (v: number) => Math.round(v * 10) / 10;
    const key = `wave-${drag.handle}-${drag.id}`;
    const len = tOut - tIn;
    if (drag.handle === "in") {
      const v = round(Math.min(t, tOut - MIN_LEN));
      onChange({ trimIn: Math.max(0, v), fadeIn: Math.min(cue.fadeIn, tOut - v) }, key);
    } else if (drag.handle === "out") {
      const v = round(Math.max(t, tIn + MIN_LEN));
      // Dragging OUT to the very end means "play to the end of the file".
      onChange({ trimOut: v >= dur - 0.05 ? null : v, fadeOut: Math.min(cue.fadeOut, v - tIn) }, key);
    } else if (drag.handle === "fadeIn") {
      onChange({ fadeIn: round(Math.max(0, Math.min(t - tIn, len - cue.fadeOut))) }, key);
    } else {
      onChange({ fadeOut: round(Math.max(0, Math.min(tOut - t, len - cue.fadeIn))) }, key);
    }
  };

  if (!cue.loudness) {
    return (
      <div style={{ height: H, borderRadius: 10, background: "var(--p2)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--mute)", fontSize: 13 }}>
        {t("b.wave.afterAnalysis")}
      </div>
    );
  }

  const fadeInX = x(tIn + cue.fadeIn);
  const fadeOutX = x(tOut - cue.fadeOut);
  const dragText = drag
    ? drag.handle === "in" ? `IN ${fmtTime(tIn)}` : drag.handle === "out" ? `OUT ${fmtTime(tOut)}`
      : drag.handle === "fadeIn" ? t("b.wave.fadeInAt", { t: fmtSecs(cue.fadeIn) }) : t("b.wave.fadeOutAt", { t: fmtSecs(cue.fadeOut) })
    : null;

  const handleStyle = (left: number, top: boolean, color: string): CSSProperties => ({
    position: "absolute", left: left - 8, [top ? "top" : "bottom"]: -2, width: 16, height: 16,
    borderRadius: top ? 8 : 3, background: color, border: "2px solid var(--bg)", cursor: "ew-resize", padding: 0, touchAction: "none",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div
        ref={boxRef}
        onPointerMove={onMove}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
        style={{ position: "relative", height: H, borderRadius: 10, background: "var(--p2)", border: "1px solid var(--line)" }}
      >
        <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: H, borderRadius: 10 }} />
        {!waveform && <span className="mono pulse" style={{ position: "absolute", left: 10, top: 8, fontSize: 11, color: "var(--mute)" }}>{t("b.loadingWave")}</span>}
        {/* Fade envelope: up from IN to the fade-in point, flat, down to OUT. */}
        <svg width={width} height={H} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} aria-hidden="true">
          <polyline
            points={`${x(tIn)},${H - 4} ${fadeInX},6 ${fadeOutX},6 ${x(tOut)},${H - 4}`}
            fill="none" stroke="var(--amb)" strokeWidth={2} strokeLinejoin="round"
          />
          {cue.markers.map((m, i) => (
            <line key={i} x1={x(m.t)} x2={x(m.t)} y1={0} y2={H} stroke="var(--lx)" strokeWidth={1.5} strokeDasharray="3 3" />
          ))}
        </svg>
        <span style={{ position: "absolute", left: x(tIn) - 1, top: 0, bottom: 0, width: 2, background: "var(--hl)" }} />
        <span style={{ position: "absolute", left: x(tOut) - 1, top: 0, bottom: 0, width: 2, background: "var(--hl)" }} />
        <button className="b" aria-label={t("b.wave.trimIn")} title={t("b.wave.dragIn")} onPointerDown={startDrag("in")} style={handleStyle(x(tIn), false, "var(--hl)")} />
        <button className="b" aria-label={t("b.wave.trimOut")} title={t("b.wave.dragOut")} onPointerDown={startDrag("out")} style={handleStyle(x(tOut), false, "var(--hl)")} />
        <button className="b" aria-label={t("b.wave.fadeInLen")} title={t("b.wave.dragFadeIn")} onPointerDown={startDrag("fadeIn")} style={handleStyle(fadeInX, true, "var(--amb)")} />
        <button className="b" aria-label={t("b.wave.fadeOutLen")} title={t("b.wave.dragFadeOut")} onPointerDown={startDrag("fadeOut")} style={handleStyle(fadeOutX, true, "var(--amb)")} />
        {dragText && (
          <span className="mono" style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", padding: "4px 10px", borderRadius: 7, background: "var(--hl)", color: "var(--bg)", fontSize: 13, fontWeight: 600, pointerEvents: "none" }}>
            {dragText}
          </span>
        )}
      </div>
      <div className="mono" style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--mute)" }}>
        <span>0:00</span>
        <span>{t("b.wave.kept", { t: fmtTime(tOut - tIn) })}</span>
        <span>{fmtTime(dur)}</span>
      </div>
    </div>
  );
}
