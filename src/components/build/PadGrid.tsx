// Build › Pads: the soundboard as a grid. Click a pad to edit it in the inspector.

import { useDoc } from "../../store";
import { trimmedLen } from "../../types";
import { PAD_MODES } from "../../lib/showOps";
import { importPadsDialog } from "../../lib/fileActions";
import { fmtTime } from "../../lib/format";
import { openMenu } from "../ContextMenu";
import { padMenu } from "../../lib/menus";

export function PadGrid() {
  const pads = useDoc((s) => s.show.pads);
  const selected = useDoc((s) => s.selectedPad);
  const analysis = useDoc((s) => s.analysis);
  const selectPad = useDoc((s) => s.selectPad);

  return (
    <div className="scroll" style={{ flex: 1, minHeight: 0, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13.5, color: "var(--dim)", flex: 1 }}>
          Pads are short sounds you fire in Run with keys 1–9 and 0. They use the same sound settings as cues.
        </span>
        <button className="b btn btn-go" onClick={() => void importPadsDialog()}>+ Import pads</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 10 }}>
        {pads.map((p) => {
          const st = analysis[p.cue.id];
          const len = trimmedLen(p.cue);
          const isSel = p.id === selected;
          return (
            <button
              key={p.id}
              className="b"
              onClick={() => selectPad(p.id)}
              onContextMenu={(e) => openMenu(e, padMenu(p))}
              aria-pressed={isSel}
              style={{
                position: "relative", overflow: "hidden", minHeight: 110, borderRadius: 14, padding: 12, textAlign: "left",
                display: "flex", flexDirection: "column", gap: 6, alignItems: "stretch",
                background: "var(--p1)", border: `1px solid ${isSel ? "var(--acc)" : "var(--line)"}`,
                boxShadow: isSel ? "inset 0 0 0 1px var(--acc)" : "none",
              }}
            >
              {/* A strip of the pad's colour along the left edge. */}
              <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 6, background: p.cue.color ?? "var(--line)" }} />
              <span style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 6 }}>
                <span className="mono" style={{ minWidth: 30, height: 30, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 600, background: p.cue.color ?? "var(--p3)", color: "var(--oncue)" }}>
                  {p.hotkey || "–"}
                </span>
                <span style={{ flex: 1 }} />
                <span className="k">{PAD_MODES.find((m) => m.value === p.mode)?.label}</span>
              </span>
              <span className="clamp1" style={{ fontSize: 18, fontWeight: 700, paddingLeft: 6 }}>{p.cue.name || "(no name)"}</span>
              <span className="mono" style={{ fontSize: 12, color: "var(--dim)", paddingLeft: 6, display: "flex", gap: 6, alignItems: "center" }}>
                {len != null ? fmtTime(len) : "–:––"}
                {!p.cue.duckBg && <span className="tag">NO DUCK</span>}
                {st?.state === "busy" && <span className="tag pulse">ANALYSING…</span>}
                {st?.state === "error" && <span className="tag tag-red">{st.unsupported ? "CONVERT" : "MISSING"}</span>}
              </span>
            </button>
          );
        })}
        {pads.length === 0 && (
          <div style={{ gridColumn: "1 / -1", padding: 24, borderRadius: 14, border: "1px dashed var(--line)", color: "var(--mute)", fontSize: 14 }}>
            No pads yet. Import a few sound effects (applause, drum roll, gong).
          </div>
        )}
      </div>
    </div>
  );
}
