// Drawing maths for the cue editor. This only DRAWS the curves; the real
// processing happens in Rust (kira effects). The formulas are the standard
// "Audio EQ Cookbook" (Robert Bristow-Johnson) biquads, close enough to show
// what an EQ setting does.

import type { Compressor, Curve, EqBand } from "../types";

const FS = 48000;

interface Biquad { b0: number; b1: number; b2: number; a0: number; a1: number; a2: number }

type Kind = "lowShelf" | "peak" | "highShelf" | "highPass";

function coeffs(kind: Kind, f0: number, gainDb: number, q: number): Biquad {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * f0) / FS;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  switch (kind) {
    case "peak":
      return { b0: 1 + alpha * A, b1: -2 * cos, b2: 1 - alpha * A, a0: 1 + alpha / A, a1: -2 * cos, a2: 1 - alpha / A };
    case "lowShelf": {
      const s = 2 * Math.sqrt(A) * alpha;
      return {
        b0: A * (A + 1 - (A - 1) * cos + s), b1: 2 * A * (A - 1 - (A + 1) * cos), b2: A * (A + 1 - (A - 1) * cos - s),
        a0: A + 1 + (A - 1) * cos + s, a1: -2 * (A - 1 + (A + 1) * cos), a2: A + 1 + (A - 1) * cos - s,
      };
    }
    case "highShelf": {
      const s = 2 * Math.sqrt(A) * alpha;
      return {
        b0: A * (A + 1 + (A - 1) * cos + s), b1: -2 * A * (A - 1 + (A + 1) * cos), b2: A * (A + 1 + (A - 1) * cos - s),
        a0: A + 1 - (A - 1) * cos + s, a1: 2 * (A - 1 - (A + 1) * cos), a2: A + 1 - (A - 1) * cos - s,
      };
    }
    case "highPass":
      return { b0: (1 + cos) / 2, b1: -(1 + cos), b2: (1 + cos) / 2, a0: 1 + alpha, a1: -2 * cos, a2: 1 - alpha };
  }
}

/** Gain in dB of one biquad at frequency f. */
function magDb(c: Biquad, f: number): number {
  const w = (2 * Math.PI * f) / FS;
  // |H(e^jw)| = |b0 + b1 e^-jw + b2 e^-2jw| / |a0 + a1 e^-jw + a2 e^-2jw|
  const re = (x0: number, x1: number, x2: number) => x0 + x1 * Math.cos(w) + x2 * Math.cos(2 * w);
  const im = (x1: number, x2: number) => -(x1 * Math.sin(w) + x2 * Math.sin(2 * w));
  const num = Math.hypot(re(c.b0, c.b1, c.b2), im(c.b1, c.b2));
  const den = Math.hypot(re(c.a0, c.a1, c.a2), im(c.a1, c.a2));
  return 20 * Math.log10(num / den);
}

/** Band 0 is a low shelf, bands 1–2 peaks, band 3 a high shelf (same as the engine). */
export function bandKind(i: number): Kind {
  return i === 0 ? "lowShelf" : i === 3 ? "highShelf" : "peak";
}

/** Total EQ (+ high-pass) response in dB at frequency f. */
export function eqResponseDb(eq: EqBand[], hpf: number | null, f: number): number {
  let db = 0;
  eq.forEach((b, i) => {
    if (b.on && b.gainDb !== 0) db += magDb(coeffs(bandKind(i), b.freq, b.gainDb, b.q), f);
  });
  if (hpf) db += magDb(coeffs("highPass", hpf, 0, Math.SQRT1_2), f);
  return db;
}

// ---- log frequency axis 20 Hz – 20 kHz ----
export const F_MIN = 20;
export const F_MAX = 20000;
export const freqToX = (f: number, w: number) => (Math.log10(f / F_MIN) / Math.log10(F_MAX / F_MIN)) * w;
export const xToFreq = (x: number, w: number) => F_MIN * Math.pow(F_MAX / F_MIN, x / w);

/** Compressor output level (dB) for an input level (dB), hard knee. */
export function compOut(c: Compressor, inDb: number): number {
  const out = inDb <= c.thresholdDb ? inDb : c.thresholdDb + (inDb - c.thresholdDb) / c.ratio;
  return out + c.makeupDb;
}

/** Fade shape: 0 → 1 over x = 0 → 1, for each curve type. */
export function fadeShape(curve: Curve, x: number): number {
  const t = Math.max(0, Math.min(1, x));
  if (curve === "linear") return t;
  if (curve === "sCurve") return 0.5 - 0.5 * Math.cos(Math.PI * t);
  return t * t; // exponential: starts slow, ends fast (sounds even to the ear)
}
