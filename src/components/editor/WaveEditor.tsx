// The big waveform in the cue editor. Everything on it can be dragged:
//   bottom: IN / OUT trim handles, attached cues (amber flags with their number)
//   top:    fade-in / fade-out handles (amber dots), vamp A / B (cyan), markers (lilac flags)
// Click the waveform to put the preview cursor there; double-click to add a marker.
// All values are seconds in the file; pixels only appear when reading the pointer.

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import type { Cue } from "../../types";
import { fadeShape } from "../../lib/dspMath";
import { fmtSecs, fmtTime } from "../../lib/format";

const H = 220;          // total height
const TOP = 30;         // space for the top row of flags
const BOTTOM = 30;      // space for the bottom row of flags
const WAVE_H = H - TOP - BOTTOM;
const MIN_LEN = 0.5;

type DragKind =
  | { k: "in" } | { k: "out" } | { k: "fadeIn" } | { k: "fadeOut" }
  | { k: "vampA" } | { k: "vampB" } | { k: "marker"; i: number } | { k: "attach"; id: string };

export interface AttachedChild { id: string; number: string; name: string; at: number }

export function WaveEditor({ cue, waveform, set, attached, setAttachedAt, cursor, setCursor, previewPos, onRenameMarker, onMenu }: {
  cue: Cue;
  waveform: number[] | undefined;
  set: (patch: Partial<Cue>, key?: string) => void;
  attached: AttachedChild[];
  setAttachedAt: (childId: string, at: number, key: string) => void;
  cursor: number;
  setCursor: (t: number) => void;
  previewPos: number | null;
  onRenameMarker: (i: number) => void;
  /** Right-click at time t (seconds in the file). */
  onMenu: (e: MouseEvent, t: number) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<{ kind: DragKind; id: number; moved: boolean } | null>(null);
  // The click that ends a drag must not also move the preview cursor.
  const justDragged = useRef(false);

  const dur = cue.loudness?.duration ?? 0;
  const tIn = cue.trimIn;
  const tOut = Math.min(cue.trimOut ?? dur, dur);
  const x = (t: number) => (dur > 0 ? (t / dur) * width : 0);
  const tAt = (clientX: number) => {
    const r = boxRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(dur, ((clientX - r.left) / r.width) * dur));
  };
  const r1 = (v: number) => Math.round(v * 10) / 10;

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Waveform bars (canvas, so 1200 points stay fast).
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !width) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(width * dpr);
    c.height = Math.round(WAVE_H * dpr);
    const g = c.getContext("2d");
    if (!g) return;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, width, WAVE_H);
    if (!waveform?.length || dur <= 0) return;
    const css = getComputedStyle(c);
    const kept = css.getPropertyValue("--acc").trim() || "#C6F432";
    const cut = css.getPropertyValue("--wave").trim() || "#888";
    const bars = Math.max(1, Math.floor(width / 2));
    for (let i = 0; i < bars; i++) {
      const a = Math.floor((i / bars) * waveform.length);
      const b = Math.max(a + 1, Math.floor(((i + 1) / bars) * waveform.length));
      let peak = 0;
      for (let j = a; j < b; j++) peak = Math.max(peak, waveform[j] ?? 0);
      const t = ((i + 0.5) / bars) * dur;
      g.fillStyle = t >= tIn && t <= tOut ? kept : cut;
      const h = Math.max(1, peak * (WAVE_H - 6));
      g.fillRect(i * 2, WAVE_H / 2 - h / 2, 1.4, h);
    }
  }, [waveform, width, dur, tIn, tOut]);

  const startDrag = (kind: DragKind) => (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    boxRef.current?.setPointerCapture(e.pointerId);
    setDrag({ kind, id: Date.now(), moved: false });
  };

  const onMove = (e: PointerEvent) => {
    if (!drag || dur <= 0) return;
    if (!drag.moved) setDrag({ ...drag, moved: true });
    const t = tAt(e.clientX);
    const key = `wave-${drag.kind.k}-${drag.id}`;
    const len = tOut - tIn;
    switch (drag.kind.k) {
      case "in": {
        const v = r1(Math.min(t, tOut - MIN_LEN));
        set({ trimIn: Math.max(0, v), fadeIn: Math.min(cue.fadeIn, tOut - v) }, key);
        break;
      }
      case "out": {
        const v = r1(Math.max(t, tIn + MIN_LEN));
        set({ trimOut: v >= dur - 0.05 ? null : v, fadeOut: Math.min(cue.fadeOut, v - tIn) }, key);
        break;
      }
      case "fadeIn":
        set({ fadeIn: r1(Math.max(0, Math.min(t - tIn, len - cue.fadeOut))) }, key);
        break;
      case "fadeOut":
        set({ fadeOut: r1(Math.max(0, Math.min(tOut - t, len - cue.fadeIn))) }, key);
        break;
      case "vampA":
        if (cue.vamp) set({ vamp: { ...cue.vamp, a: r1(Math.min(t, cue.vamp.b - MIN_LEN)) } }, key);
        break;
      case "vampB":
        if (cue.vamp) set({ vamp: { ...cue.vamp, b: r1(Math.max(t, cue.vamp.a + MIN_LEN)) } }, key);
        break;
      case "marker": {
        const i = drag.kind.i;
        set({ markers: cue.markers.map((m, j) => (j === i ? { ...m, t: r1(t) } : m)) }, key);
        break;
      }
      case "attach":
        setAttachedAt(drag.kind.id, r1(t), key);
        break;
    }
  };

  const endDrag = () => {
    // A marker flag clicked without moving: rename it.
    if (drag && !drag.moved && drag.kind.k === "marker") onRenameMarker(drag.kind.i);
    if (drag) {
      justDragged.current = true;
      setTimeout(() => (justDragged.current = false), 0);
    }
    setDrag(null);
  };

  if (!cue.loudness) {
    return (
      <div style={{ height: H, borderRadius: 12, background: "var(--p1)", border: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--mute)" }}>
        The waveform appears once the file has been analysed.
      </div>
    );
  }

  // Envelope line: fades drawn with the chosen curve shape.
  const env: string[] = [];
  const yOf = (gain: number) => TOP + 4 + (1 - gain) * (WAVE_H - 8);
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const t = tIn + (cue.fadeIn * i) / steps;
    env.push(`${x(t)},${yOf(cue.fadeIn > 0 ? fadeShape(cue.curve, i / steps) : 1)}`);
  }
  for (let i = 0; i <= steps; i++) {
    const t = tOut - cue.fadeOut + (cue.fadeOut * i) / steps;
    env.push(`${x(t)},${yOf(cue.fadeOut > 0 ? fadeShape(cue.curve, 1 - i / steps) : 1)}`);
  }

  const handle = (left: number, top: number, color: string, round: boolean): CSSProperties => ({
    position: "absolute", left: left - 8, top, width: 16, height: 16, borderRadius: round ? 8 : 3, padding: 0,
    background: color, border: "2px solid var(--bg)", cursor: "ew-resize", touchAction: "none", zIndex: 3,
  });
  const flag = (left: number, top: number, bg: string, fg: string): CSSProperties => ({
    position: "absolute", left, top, height: 22, padding: "0 7px", borderRadius: "0 6px 6px 0",
    display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap",
    background: bg, color: fg, cursor: "ew-resize", touchAction: "none", zIndex: 4, border: 0,
  });

  const dragText = drag?.moved ? (() => {
    switch (drag.kind.k) {
      case "in": return `IN ${fmtTime(tIn)}`;
      case "out": return `OUT ${fmtTime(tOut)}`;
      case "fadeIn": return `Fade in ${fmtSecs(cue.fadeIn)}`;
      case "fadeOut": return `Fade out ${fmtSecs(cue.fadeOut)}`;
      case "vampA": return `Loop A ${fmtTime(cue.vamp?.a ?? 0)}`;
      case "vampB": return `Loop B ${fmtTime(cue.vamp?.b ?? 0)}`;
      case "marker": return `${cue.markers[drag.kind.i]?.label} ${fmtTime(cue.markers[drag.kind.i]?.t ?? 0)}`;
      case "attach": { const id = drag.kind.id; const a = attached.find((c) => c.id === id); return a ? `${a.number} at ${fmtTime(a.at)}` : ""; }
    }
  })() : null;

  return (
    <div
      ref={boxRef}
      onPointerMove={onMove}
      onPointerUp={endDrag}
      onPointerCancel={() => setDrag(null)}
      onClick={(e) => { if (!drag && !justDragged.current) setCursor(r1(tAt(e.clientX))); }}
      onContextMenu={(e) => onMenu(e, r1(tAt(e.clientX)))}
      onDoubleClick={(e) => {
        const t = r1(tAt(e.clientX));
        const markers = [...cue.markers, { t, label: `marker ${cue.markers.length + 1}` }].sort((a, b) => a.t - b.t);
        set({ markers });
      }}
      style={{ position: "relative", height: H, borderRadius: 12, background: "var(--p1)", border: "1px solid var(--line)", overflow: "hidden", cursor: "crosshair" }}
    >
      {/* Trimmed-off parts are dimmed. */}
      <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: x(tIn), background: "var(--p2)" }} />
      <span style={{ position: "absolute", left: x(tOut), right: 0, top: 0, bottom: 0, background: "var(--p2)" }} />
      {cue.vamp && (
        <span style={{ position: "absolute", top: TOP, height: WAVE_H, left: x(cue.vamp.a), width: x(cue.vamp.b) - x(cue.vamp.a), background: "var(--cy)", opacity: cue.vamp.on ? 0.22 : 0.08 }} />
      )}
      <canvas ref={canvasRef} style={{ position: "absolute", left: 0, top: TOP, width: "100%", height: WAVE_H, pointerEvents: "none" }} />
      {!waveform && <span className="mono pulse" style={{ position: "absolute", left: 12, top: TOP + 8, fontSize: 12, color: "var(--mute)" }}>loading waveform…</span>}

      <svg width={width} height={H} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} aria-hidden="true">
        <polyline points={env.join(" ")} fill="none" stroke="var(--amb)" strokeWidth={2.2} strokeLinejoin="round" />
        {cue.markers.map((m, i) => <line key={i} x1={x(m.t)} x2={x(m.t)} y1={TOP - 8} y2={H - BOTTOM} stroke="var(--lx)" strokeWidth={1.5} strokeDasharray="4 3" />)}
        {attached.map((a) => <line key={a.id} x1={x(a.at)} x2={x(a.at)} y1={TOP} y2={H - BOTTOM + 8} stroke="var(--amb)" strokeWidth={2} />)}
        <line x1={x(tIn)} x2={x(tIn)} y1={0} y2={H} stroke="var(--hl)" strokeWidth={2} />
        <line x1={x(tOut)} x2={x(tOut)} y1={0} y2={H} stroke="var(--hl)" strokeWidth={2} />
        {/* Preview cursor (where H starts) and the live preview position. */}
        <line x1={x(cursor)} x2={x(cursor)} y1={TOP} y2={H - BOTTOM} stroke="var(--st)" strokeWidth={1.5} strokeDasharray="2 3" />
        {previewPos !== null && <line x1={x(previewPos)} x2={x(previewPos)} y1={0} y2={H} stroke="var(--st)" strokeWidth={2.5} />}
      </svg>

      {/* Top row: fade handles, vamp A/B, markers */}
      <button className="b" aria-label="Fade-in length" title="Drag: fade in" onPointerDown={startDrag({ k: "fadeIn" })} style={handle(x(tIn + cue.fadeIn), TOP - 4, "var(--amb)", true)} />
      <button className="b" aria-label="Fade-out length" title="Drag: fade out" onPointerDown={startDrag({ k: "fadeOut" })} style={handle(x(tOut - cue.fadeOut), TOP - 4, "var(--amb)", true)} />
      {cue.vamp && (
        <>
          <button className="b mono" aria-label="Vamp loop start" onPointerDown={startDrag({ k: "vampA" })} style={flag(x(cue.vamp.a), TOP + WAVE_H - 24, "var(--cy)", "var(--oncy)")}>A</button>
          <button className="b mono" aria-label="Vamp loop end" onPointerDown={startDrag({ k: "vampB" })} style={{ ...flag(x(cue.vamp.b) - 22, TOP + WAVE_H - 24, "var(--cy)", "var(--oncy)"), borderRadius: "6px 0 0 6px" }}>B</button>
        </>
      )}
      {cue.markers.map((m, i) => (
        <button key={i} className="b" title="Drag to move · click to rename" onPointerDown={startDrag({ k: "marker", i })} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
          style={flag(x(m.t), 2, "var(--lxbg)", "var(--lx)")}>
          {m.label}
        </button>
      ))}

      {/* Bottom row: trim handles and attached cues */}
      <button className="b mono" aria-label="Trim in" title="Drag: trim in" onPointerDown={startDrag({ k: "in" })} style={flag(x(tIn), H - 26, "var(--hl)", "var(--bg)")}>IN</button>
      <button className="b mono" aria-label="Trim out" title="Drag: trim out" onPointerDown={startDrag({ k: "out" })} style={{ ...flag(x(tOut) - 38, H - 26, "var(--hl)", "var(--bg)"), borderRadius: "6px 0 0 6px" }}>OUT</button>
      {attached.map((a) => (
        <button key={a.id} className="b mono" title={`${a.number} ${a.name}: drag to change when it starts`} onPointerDown={startDrag({ k: "attach", id: a.id })} onClick={(e) => e.stopPropagation()}
          style={flag(x(a.at), H - 52, "var(--amb)", "var(--onamb)")}>
          {a.number}
        </button>
      ))}

      {dragText && (
        <span className="mono" style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", padding: "6px 12px", borderRadius: 8, background: "var(--hl)", color: "var(--bg)", fontSize: 15, fontWeight: 600, pointerEvents: "none", zIndex: 5 }}>
          {dragText}
        </span>
      )}
    </div>
  );
}
