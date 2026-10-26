// Printable cue sheet (Ctrl+P). The sheet is always in the page but hidden on screen;
// @media print hides the app and shows only the sheet. A small dialog picks A4 or A3.

import { useState } from "react";
import { useDoc } from "../store";
import { useEngine } from "../engineStore";
import { useUi } from "../uiStore";
import type { Cue } from "../types";
import { passLen } from "../types";
import { fmtTime } from "../lib/format";
import { cueRunLen } from "../lib/showMath";
import logoPrint from "../assets/logo-print.png";

let paper: "A4" | "A3" = "A4";

export function PrintDialog() {
  const close = useUi((s) => s.closeDialog);
  const [size, setSize] = useState<"A4" | "A3">(paper);
  const print = () => {
    paper = size;
    close();
    // Let React remove the dialog and apply the page size before the print dialog opens.
    setTimeout(() => {
      const style = document.getElementById("print-page-size") ?? document.head.appendChild(Object.assign(document.createElement("style"), { id: "print-page-size" }));
      style.textContent = `@page { size: ${size} portrait; margin: 12mm; }`;
      window.print();
    }, 50);
  };
  return (
    <div className="scrim" style={{ zIndex: 66 }}>
      <div role="dialog" aria-label="Print cue sheet" className="dialog" style={{ maxWidth: 420 }}>
        <span className="cond" style={{ fontSize: 24, fontWeight: 800 }}>Print cue sheet</span>
        <span style={{ fontSize: 13.5, color: "var(--dim)" }}>Every cue with its notes, length and approximate start time, grouped by section, with a tick box.</span>
        <div className="chips">
          {(["A4", "A3"] as const).map((s) => <button key={s} className="b chip" aria-pressed={size === s} onClick={() => setSize(s)} style={{ height: 36, padding: "0 18px" }}>{s} portrait</button>)}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="b btn" onClick={close} style={{ height: 40 }}>Cancel</button>
          <button className="b btn btn-go" onClick={print} style={{ height: 40 }}>Print…</button>
        </div>
      </div>
    </div>
  );
}

function followText(c: Cue, next: Cue | undefined): string {
  const n = next ? `${next.number}` : "next";
  if (c.follow.kind === "afterEnd") return `→ ${n} at end`;
  if (c.follow.kind === "afterStart") return `→ ${n} after ${c.follow.delay} s`;
  return "";
}

export function PrintSheet() {
  const show = useDoc((s) => s.show);
  const plan = useEngine((s) => s.plan);
  // Approximate start: the sum of the lengths before it (rehearsed times when adopted as the plan).
  let clock = 0;
  const queue = show.sections.flatMap((s) => s.cues.filter((c) => !c.attach));
  const start = new Map<string, number>();
  for (const c of queue) {
    start.set(c.id, clock);
    clock += plan?.[c.id] ?? cueRunLen(c);
  }

  return (
    <div className="print-sheet">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "6mm", borderBottom: "2px solid #000", paddingBottom: 4 }}>
        {/* The light word mark (made for paper). */}
        <img src={logoPrint} alt="StageGremlin" style={{ height: "11mm", width: "auto" }} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
          <h1 style={{ margin: 0, fontSize: "18pt" }}>{show.name}</h1>
          <span style={{ fontSize: "9pt" }}>Cue sheet · {queue.length} cues · {fmtTime(clock)} · printed {new Date().toLocaleDateString("nl-BE")}</span>
        </div>
      </div>
      {show.sections.map((sec) => (
        <section key={sec.id} style={{ breakInside: "avoid-page" }}>
          <h2 style={{ fontSize: "11pt", textTransform: "uppercase", letterSpacing: ".1em", margin: "10pt 0 3pt", borderBottom: "1px solid #000" }}>{sec.name}</h2>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "9pt" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={{ width: "6mm" }}></th><th style={{ width: "10mm" }}>#</th><th>Cue</th><th>Sound</th><th>Light</th><th>Stage</th>
                <th style={{ width: "16mm", textAlign: "right" }}>Length</th><th style={{ width: "14mm", textAlign: "right" }}>~Start</th><th style={{ width: "22mm" }}>Then</th>
              </tr>
            </thead>
            <tbody>
              {sec.cues.map((c, i) => {
                const len = passLen(c);
                const reps = c.playCount === 0 ? " loop" : c.playCount > 1 ? ` ×${c.playCount}` : "";
                return (
                  <tr key={c.id} style={{ borderTop: "0.5pt solid #999", breakInside: "avoid", verticalAlign: "top" }}>
                    <td><span style={{ display: "inline-block", width: "3.5mm", height: "3.5mm", border: "1pt solid #000" }} /></td>
                    <td style={{ fontWeight: 700 }}>{c.number}</td>
                    <td style={{ fontWeight: 700 }}>{c.name}{c.attach ? <span style={{ fontWeight: 400 }}> (by itself at {fmtTime(c.attach.at)})</span> : null}</td>
                    <td>{c.notes.sound}</td>
                    <td>{c.notes.lx}</td>
                    <td>{c.notes.stage}</td>
                    <td style={{ textAlign: "right" }}>{len ? fmtTime(len) : "–"}{reps}</td>
                    <td style={{ textAlign: "right" }}>{start.has(c.id) ? fmtTime(start.get(c.id)!) : ""}</td>
                    <td>{followText(c, sec.cues[i + 1])}{c.fadeGo ? ` fade others ${c.fadeGo} s` : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
