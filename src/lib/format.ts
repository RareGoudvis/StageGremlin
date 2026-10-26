// Small formatting helpers for times and levels.

/** 83.4 → "1:23". Negative numbers get a minus sign. */
export function fmtTime(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "–:––";
  const neg = sec < 0;
  const s = Math.floor(Math.abs(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  const body = h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
  return (neg ? "−" : "") + body;
}

/** Like fmtTime but with tenths, for short values: 3.25 → "3.2 s"; 75 → "1:15". */
export function fmtSecs(sec: number): string {
  if (sec < 60) return `${sec.toFixed(sec < 10 ? 1 : 0)} s`;
  return fmtTime(sec);
}

/** +4.2 dB / −3.0 dB with a real minus sign. */
export function fmtDb(db: number, digits = 1): string {
  const v = db.toFixed(digits);
  if (Number(v) === 0) return (0).toFixed(digits) + " dB";
  return (db > 0 ? "+" : "−") + Math.abs(db).toFixed(digits) + " dB";
}

/** Linear peak 0..1 → dBFS (−inf clamped to −90). */
export function linToDb(x: number): number {
  return x > 0 ? 20 * Math.log10(x) : -90;
}
