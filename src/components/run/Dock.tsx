// The dock under GO: Pads / Background / AUDAC (when an MTX is set up) / Log.

import { useEffect, useRef, useState } from "react";
import { useEngine } from "../../engineStore";
import type { LogEntry } from "../../types";
import { PadsDock } from "./PadsDock";
import { BackgroundDock } from "../background/BackgroundDock";
import { AudacPanel } from "../audac/AudacPanel";
import { useAudacConfigured } from "../../lib/audac";
import { useSettings } from "../../settingsStore";

type Tab = "pads" | "bg" | "audac" | "log";

export function Dock() {
  const [tab, setTab] = useState<Tab>("pads");
  // Hidden in Run when this laptop says so (Settings › AUDAC › In Run).
  const audacOn = useAudacConfigured() && useSettings((s) => s.ui.audac.inRun) !== "hide";
  const tabs: { id: Tab; label: string }[] = [
    { id: "pads", label: "PADS" },
    { id: "bg", label: "BACKGROUND" },
    ...(audacOn ? [{ id: "audac" as const, label: "AUDAC" }] : []),
    { id: "log", label: "LOG" },
  ];
  return (
    <section aria-label="Dock" style={{ flex: 1, minHeight: 160, display: "flex", flexDirection: "column", borderRadius: 12, overflow: "hidden", background: "var(--p1)", border: "1px solid var(--line)" }}>
      <div role="tablist" aria-label="Dock" style={{ display: "flex", gap: 2, padding: 4, borderBottom: "1px solid var(--line)" }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            tabIndex={-1}
            aria-selected={tab === t.id}
            className="b cond"
            onClick={() => setTab(t.id)}
            style={{
              flex: 1, height: 32, borderRadius: 7, fontSize: 12, fontWeight: 800, letterSpacing: ".08em",
              background: tab === t.id ? "var(--hl)" : "transparent", color: tab === t.id ? "var(--bg)" : "var(--dim)",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "pads" && <PadsDock />}
      {tab === "bg" && <BackgroundDock />}
      {tab === "audac" && <div style={{ flex: 1, minHeight: 0, padding: 8, display: "flex", flexDirection: "column" }}><AudacPanel inRun /></div>}
      {tab === "log" && <Log />}
    </section>
  );
}

const KIND_COLOR: Record<string, string> = {
  go: "var(--acc)", follow: "var(--acc)", attached: "var(--amb)", stop: "var(--dim)",
  stopAll: "var(--amb)", panic: "var(--redtx)", skip: "var(--redtx)",
};

function Log() {
  const log = useEngine((s) => s.log);
  const ref = useRef<HTMLDivElement>(null);
  // Keep the newest line in view.
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [log.length]);
  return (
    <div ref={ref} className="scroll" style={{ flex: 1, minHeight: 0, padding: "8px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
      {log.length === 0 && <span style={{ fontSize: 13, color: "var(--mute)" }}>Every GO, stop and skip is written here with the time.</span>}
      {log.map((l, i) => <LogLine key={i} entry={l} />)}
    </div>
  );
}

function LogLine({ entry }: { entry: LogEntry }) {
  const t = new Date(entry.wallMs).toLocaleTimeString("nl-BE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return (
    <div style={{ display: "flex", gap: 10, fontSize: 13 }}>
      <span className="mono" style={{ color: "var(--mute)", width: 62, flex: "none" }}>{t}</span>
      <span className="k" style={{ width: 54, flex: "none", fontSize: 10, color: KIND_COLOR[entry.kind] ?? "var(--dim)", paddingTop: 2 }}>{entry.kind}</span>
      <span style={{ color: "var(--text)" }}>{entry.text}</span>
    </div>
  );
}
