// Run › dock › Pads: big coloured buttons. Lit while the pad plays. Keys 1–9 and 0 fire them too.

import { useDoc } from "../../store";
import { useEngine } from "../../engineStore";
import { firePad } from "../../lib/runActions";
import { PAD_MODES } from "../../lib/showOps";
import { useT } from "../../i18n";

export function PadsDock() {
  const pads = useDoc((s) => s.show.pads);
  const t = useT();
  // A joined string keeps this selector stable between 30 Hz updates.
  const playingIds = useEngine((s) => s.state?.running.filter((r) => r.padId).map((r) => r.padId).join(",") ?? "");
  const playing = new Set(playingIds.split(",").filter(Boolean));

  if (!pads.length) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, textAlign: "center", color: "var(--mute)", fontSize: 13.5 }}>
        {t("r.pads.none")}
      </div>
    );
  }
  return (
    <div className="scroll" style={{ flex: 1, minHeight: 0, padding: 8, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6, alignContent: "start" }}>
      {pads.map((p) => {
        const on = playing.has(p.id);
        const color = p.cue.color ?? "var(--acc)";
        return (
          <button
            key={p.id}
            className="b"
            tabIndex={-1}
            onClick={() => firePad(p.id)}
            title={`${PAD_MODES.find((m) => m.value === p.mode)?.hint}`}
            style={{
              position: "relative", minHeight: 64, borderRadius: 10, padding: "8px 10px", textAlign: "left",
              display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 4,
              // Lit = the pad's own colour with dark text; idle = dark tile with a coloured edge.
              background: on ? color : "var(--p2)",
              color: on ? "var(--oncue)" : "var(--text)",
              boxShadow: on ? `0 0 0 2px ${color}, 0 0 18px ${color}` : `inset 4px 0 0 ${color}`,
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className="mono" style={{ fontSize: 13, fontWeight: 600, padding: "1px 6px", borderRadius: 5, background: on ? "rgba(0,0,0,.18)" : "var(--p3)" }}>{p.hotkey || "–"}</span>
              {p.mode !== "oneShot" && <span className="k" style={{ fontSize: 9.5, color: on ? "var(--oncue)" : "var(--mute)" }}>{p.mode === "loop" ? t("r.pads.loop") : t("r.pads.toggle")}</span>}
            </span>
            <span className="clamp1" style={{ fontSize: 14, fontWeight: 700 }}>{p.cue.name}</span>
          </button>
        );
      })}
    </div>
  );
}
