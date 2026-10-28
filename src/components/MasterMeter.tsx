// Master output meter for the top bar: L/R peak bars with peak hold, a clip light
// and the limiter's gain reduction. Reads only the meter from the engine store.

import { useRef } from "react";
import { useEngine } from "../engineStore";
import { linToDb } from "../lib/format";
import { useT } from "../i18n";

const FLOOR_DB = -48;
const HOLD_MS = 1500;
const CLIP_LATCH_MS = 2000;

/** 0..1 position on the meter for a dB value. */
const pos = (db: number) => Math.max(0, Math.min(1, (db - FLOOR_DB) / -FLOOR_DB));

export function MasterMeter() {
  const meter = useEngine((s) => s.state?.meter);
  const t = useT();
  const hold = useRef({ l: FLOOR_DB, r: FLOOR_DB, lAt: 0, rAt: 0, clipAt: 0 });
  const now = performance.now();
  const dbL = linToDb(meter?.peakL ?? 0);
  const dbR = linToDb(meter?.peakR ?? 0);
  const gr = meter?.grDb ?? 0;
  // Short-term loudness from the engine (newer engines send it; older ones don't).
  const raw = (meter as { lufsS?: number } | undefined)?.lufsS;
  const lufsS = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  const h = hold.current;
  // Peak hold: keep the highest value for 1.5 s, then let it drop to the current level.
  if (dbL >= h.l || now - h.lAt > HOLD_MS) { h.l = dbL; h.lAt = now; }
  if (dbR >= h.r || now - h.rAt > HOLD_MS) { h.r = dbR; h.rAt = now; }
  // Clip light: the output reached full scale, or the limiter is working very hard.
  if ((meter?.peakL ?? 0) >= 0.999 || (meter?.peakR ?? 0) >= 0.999 || gr >= 6) h.clipAt = now;
  const clip = h.clipAt > 0 && now - h.clipAt < CLIP_LATCH_MS;

  const bar = (db: number, holdDb: number, label: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span className="mono" style={{ fontSize: 9.5, color: "var(--mute)", width: 7 }}>{label}</span>
      <div style={{ position: "relative", width: 150, height: 7, background: "var(--p3)", borderRadius: 2, overflow: "hidden" }}>
        <div
          style={{
            position: "absolute", left: 0, top: 0, bottom: 0, width: `${pos(db) * 100}%`,
            // Green up to −12, amber to −3, red above: same gradient as the mockup.
            background: "linear-gradient(to right, var(--acc) 0%, var(--acc) 75%, var(--amb) 88%, var(--red) 100%)",
            backgroundSize: "150px 100%",
          }}
        />
        <span style={{ position: "absolute", top: 0, bottom: 0, width: 2, left: `calc(${pos(holdDb) * 100}% - 2px)`, background: "var(--hl)", opacity: holdDb > FLOOR_DB ? 1 : 0 }} />
      </div>
    </div>
  );

  return (
    <div aria-label={t("m.meter.aria")} style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {bar(dbL, h.l, "L")}
        {bar(dbR, h.r, "R")}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1, alignItems: "flex-start", width: 74 }}>
        <span
          className="mono"
          style={{
            fontSize: 9.5, fontWeight: 600, padding: "1px 5px", borderRadius: 4,
            background: clip ? "var(--red)" : "var(--p3)", color: clip ? "var(--onred)" : "var(--mute)",
          }}
        >
          CLIP
        </span>
        <span className="mono" title={t("m.meter.lufs")} style={{ fontSize: 10.5, color: lufsS !== null && lufsS > -10 ? "var(--amb)" : "var(--dim)" }}>
          {lufsS !== null && lufsS > -70 ? `${lufsS.toFixed(1)} LUFS` : "– LUFS"}
        </span>
        <span className="mono" title={t("m.meter.gr")} style={{ fontSize: 10.5, color: gr > 0.5 ? "var(--amb)" : "var(--mute)" }}>
          GR {gr > 0.05 ? "−" + gr.toFixed(1) : "0.0"}
        </span>
      </div>
    </div>
  );
}
