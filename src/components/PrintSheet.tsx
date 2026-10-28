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
import { useT } from "../i18n";

let paper: "A4" | "A3" = "A4";

export function PrintDialog() {
  const t = useT();
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
      <div role="dialog" aria-label={t("b.print.title")} className="dialog" style={{ maxWidth: 420 }}>
        <span className="cond" style={{ fontSize: 24, fontWeight: 800 }}>{t("b.print.title")}</span>
        <span style={{ fontSize: 13.5, color: "var(--dim)" }}>{t("b.print.desc")}</span>
        <div className="chips">
          {(["A4", "A3"] as const).map((s) => <button key={s} className="b chip" aria-pressed={size === s} onClick={() => setSize(s)} style={{ height: 36, padding: "0 18px" }}>{t("b.print.portrait", { size: s })}</button>)}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="b btn" onClick={close} style={{ height: 40 }}>{t("cancel")}</button>
          <button className="b btn btn-go" onClick={print} style={{ height: 40 }}>{t("b.print.print")}</button>
        </div>
      </div>
    </div>
  );
}

function followText(t: ReturnType<typeof useT>, c: Cue, next: Cue | undefined): string {
  const n = next ? `${next.number}` : t("b.print.next");
  if (c.follow.kind === "afterEnd") return t("b.print.atEnd", { n });
  if (c.follow.kind === "afterStart") return t("b.print.after", { n, d: c.follow.delay });
  return "";
}

/** What starting this cue does to the others ("stops the others", …), with a leading space; empty when nothing. */
function exclusiveText(t: ReturnType<typeof useT>, c: Cue): string {
  if (c.exclusive === "stop") return " " + t("b.print.exStop");
  if (c.exclusive === "fade") return " " + t("b.print.exFade", { s: c.exclusiveSecs });
  if (c.exclusive === "crossfade") return " " + t("b.print.exCrossfade", { s: c.exclusiveSecs });
  return "";
}

export function PrintSheet() {
  const t = useT();
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
          <span style={{ fontSize: "9pt" }}>{t("b.print.header", { n: queue.length, t: fmtTime(clock), date: new Date().toLocaleDateString("nl-BE") })}</span>
        </div>
      </div>
      {show.sections.map((sec) => (
        <section key={sec.id} style={{ breakInside: "avoid-page" }}>
          <h2 style={{ fontSize: "11pt", textTransform: "uppercase", letterSpacing: ".1em", margin: "10pt 0 3pt", borderBottom: "1px solid #000" }}>{sec.name}</h2>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "9pt" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={{ width: "6mm" }}></th><th style={{ width: "10mm" }}>#</th><th>{t("b.print.cue")}</th><th>{t("insp.sound")}</th><th>{t("b.print.light")}</th><th>{t("b.print.stage")}</th>
                <th style={{ width: "16mm", textAlign: "right" }}>{t("b.print.length")}</th><th style={{ width: "14mm", textAlign: "right" }}>{t("b.print.start")}</th><th style={{ width: "22mm" }}>{t("run.then")}</th>
              </tr>
            </thead>
            <tbody>
              {sec.cues.map((c, i) => {
                const len = passLen(c);
                const reps = c.playCount === 0 ? " " + t("b.print.loop") : c.playCount > 1 ? ` ×${c.playCount}` : "";
                return (
                  <tr key={c.id} style={{ borderTop: "0.5pt solid #999", breakInside: "avoid", verticalAlign: "top" }}>
                    <td><span style={{ display: "inline-block", width: "3.5mm", height: "3.5mm", border: "1pt solid #000" }} /></td>
                    <td style={{ fontWeight: 700 }}>{c.number}</td>
                    <td style={{ fontWeight: 700 }}>{c.name}{c.attach ? <span style={{ fontWeight: 400 }}> {t("b.print.byItself", { t: fmtTime(c.attach.at) })}</span> : null}</td>
                    <td>{c.notes.sound}</td>
                    <td>{c.notes.lx}</td>
                    <td>{c.notes.stage}</td>
                    <td style={{ textAlign: "right" }}>{len ? fmtTime(len) : "–"}{reps}</td>
                    <td style={{ textAlign: "right" }}>{start.has(c.id) ? fmtTime(start.get(c.id)!) : ""}</td>
                    <td>{followText(t, c, sec.cues[i + 1])}{exclusiveText(t, c)}</td>
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
