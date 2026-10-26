// Build's left rail: what you are building — the cue list, the pads or the media bin.
// One click swaps the middle of the screen; the inspector on the right stays.

import type { ReactNode } from "react";
import { useDoc, type BuildTab } from "../../store";
import { useT, type TKey } from "../../i18n";
import { FolderIcon, ListIcon, PadsIcon } from "../Icons";

const ITEMS: { id: BuildTab; label: TKey; icon: () => ReactNode }[] = [
  { id: "cues", label: "rail.cues", icon: () => <ListIcon /> },
  { id: "pads", label: "rail.pads", icon: () => <PadsIcon /> },
  { id: "media", label: "rail.media", icon: () => <FolderIcon /> },
];

export function BuildRail() {
  const t = useT();
  const tab = useDoc((s) => s.buildTab);
  const padCount = useDoc((s) => s.show.pads.length);
  return (
    <nav aria-label="Build" style={{ width: 76, flex: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "14px 0", borderRight: "1px solid var(--line)", background: "var(--p1)" }}>
      {ITEMS.map((it) => {
        const on = tab === it.id;
        return (
          <button
            key={it.id} className="b" aria-pressed={on} onClick={() => useDoc.getState().setBuildTab(it.id)}
            title={it.id === "pads" ? `${t(it.label)} · ${padCount}` : t(it.label)}
            style={{ width: 60, height: 58, borderRadius: 12, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, background: on ? "var(--hl)" : "transparent", color: on ? "var(--bg)" : "var(--dim)" }}
          >
            {it.icon()}
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".04em" }}>{t(it.label)}</span>
          </button>
        );
      })}
    </nav>
  );
}
