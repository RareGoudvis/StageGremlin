// Scrollable "up next" list under the now-playing card: the cue standing by and
// everything after it. Each row can Skip to (move the playhead) or Make next (move the cue).

import { useEffect, useRef } from "react";
import { useDoc } from "../../store";
import type { Cue } from "../../types";
import { goQueue, trimmedLen } from "../../types";
import { fmtTime } from "../../lib/format";
import { cueRunLen } from "../../lib/showMath";
import { goFrom, makeNext, skipTo } from "../../lib/runActions";
import { useEngine } from "../../engineStore";
import { useUi } from "../../uiStore";
import { previewToggle, usePreview, usePreviewInHall } from "../../lib/preview";
import { Search } from "../Icons";

/** The cues the list shows, filtered by the search text. Shared with RunView's ↑/↓ keys. */
export function upNextCues(queue: Cue[], playhead: string | null, query: string): Cue[] {
  const start = playhead ? queue.findIndex((c) => c.id === playhead) : queue.length;
  const rest = queue.slice(start < 0 ? queue.length : start);
  const q = query.trim().toLowerCase();
  if (!q) return rest;
  return rest.filter((c) => `${c.number} ${c.name} ${c.notes.sound} ${c.notes.lx} ${c.notes.stage}`.toLowerCase().includes(q));
}

export function UpNext({ playhead, selectedId, onSelect, search, setSearch, searchOpen, closeSearch }: {
  playhead: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  search: string;
  setSearch: (v: string) => void;
  searchOpen: boolean;
  closeSearch: () => void;
}) {
  const show = useDoc((s) => s.show);
  const queue = goQueue(show);
  const rows = upNextCues(queue, playhead, search);
  const total = upNextCues(queue, playhead, "").reduce((a, c) => a + cueRunLen(c), 0);
  const sectionOf = new Map(show.sections.flatMap((s) => s.cues.map((c) => [c.id, s.name] as const)));
  const childrenOf = (id: string) => show.sections.flatMap((s) => s.cues).filter((c) => c.attach?.to === id);
  const rehearsal = useEngine((s) => s.rehearsal);
  const measured = useEngine((s) => s.measured);
  const previewId = usePreview((s) => (s.state?.playing ? s.cueId : null));
  const inHall = usePreviewInHall();
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // A new cue stands by: bring the top of the list (the standby row) back into view.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [playhead]);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);
  useEffect(() => {
    if (selectedId) document.querySelector(`[data-upnext="${selectedId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  let lastSection: string | undefined;
  return (
    <section aria-label="Up next" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", borderRadius: 14, border: "1px solid var(--line)", background: "var(--p1)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px 8px 14px", borderBottom: "1px solid var(--line)", minHeight: 50 }}>
        <span className="k" style={{ color: "var(--text)" }}>Up next · {rows.length}</span>
        {inHall && <span className="tag tag-red" title="The headphone output is the same device as the show output">PREVIEW WOULD PLAY IN THE HALL</span>}
        <span className="mono" style={{ fontSize: 12, color: "var(--mute)" }}>{fmtTime(total)} to go</span>
        <span style={{ flex: 1 }} />
        {searchOpen ? (
          <label style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--p2)", borderRadius: 8, padding: "0 10px", height: 34, width: 260, outline: "2px solid var(--acc)", color: "var(--dim)" }}>
            <Search />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find a cue — Esc closes"
              aria-label="Find a cue"
              onKeyDown={(e) => {
                if (e.key === "Enter" && rows[0]) { onSelect(rows[0].id); closeSearch(); }
              }}
              style={{ border: 0, background: "transparent", color: "var(--text)", font: "inherit", fontSize: 14, width: "100%", outline: "none", userSelect: "text" }}
            />
          </label>
        ) : (
          <span className="mono" style={{ fontSize: 11.5, color: "var(--mute)", display: "flex", alignItems: "center", gap: 6 }}><Search /> Ctrl+K · ↑/↓</span>
        )}
      </div>
      <div ref={listRef} className="scroll" style={{ flex: 1, minHeight: 0, padding: 6 }}>
        {rows.map((c, i) => {
          const sec = sectionOf.get(c.id);
          const header = sec !== lastSection ? sec : undefined;
          lastSection = sec;
          const standby = c.id === playhead;
          const selected = c.id === selectedId;
          const kids = childrenOf(c.id);
          const len = trimmedLen(c);
          return (
            <div key={c.id}>
              {header && <div className="cond" style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".12em", color: "var(--acc)", padding: "10px 10px 4px", textTransform: "uppercase" }}>{header}</div>}
              <div
                data-upnext={c.id}
                onClick={() => onSelect(c.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 10,
                  background: standby ? "var(--p2)" : selected ? "var(--p2)" : "transparent",
                  boxShadow: standby ? "inset 0 0 0 1px var(--acc)" : selected ? "inset 0 0 0 1px var(--hl)" : "none",
                }}
              >
                <span className="k" style={{ width: 58, color: standby ? "var(--acc)" : undefined }}>{standby ? "Standby" : i === 1 && !search ? "Then" : ""}</span>
                <span className="mono" style={{ fontSize: 17, fontWeight: 600, width: 40 }}>{c.number}</span>
                <span style={{ width: 4, alignSelf: "stretch", borderRadius: 2, background: c.color ?? "var(--line)" }} />
                <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, gap: 1 }}>
                  <span className="clamp1" style={{ fontSize: 17, fontWeight: 700 }}>{c.name}</span>
                  <span className="clamp1" style={{ fontSize: 13.5, color: c.notes.sound ? "var(--ambtx)" : "var(--mute)" }}>
                    {c.notes.sound || "—"}{kids.length ? ` · fires ${kids.map((k) => k.number).join(", ")} inside` : ""}
                  </span>
                  {c.notes.lx && <span className="clamp1" style={{ fontSize: 12.5, color: "var(--lx)" }}>LX · {c.notes.lx}</span>}
                  {rehearsal && (
                    <span style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 3 }}>
                      <span className="k" style={{ fontSize: 9.5, alignSelf: "center" }}>Start from</span>
                      {[{ t: c.trimIn, label: "start" }, ...c.markers].map((m) => (
                        <button key={m.label + m.t} className="b btn" tabIndex={-1} onClick={(e) => { e.stopPropagation(); goFrom(c.id, m.t); }}
                          style={{ height: 24, fontSize: 11.5, padding: "0 8px", background: "var(--ambbg)", color: "var(--ambtx)", fontWeight: 700 }}>
                          ▶ {m.label}
                        </button>
                      ))}
                    </span>
                  )}
                </span>
                <span className="mono" style={{ fontSize: 13, color: "var(--dim)", textAlign: "right", width: 64 }}>
                  {len != null ? fmtTime(len) : "–:––"}
                  {c.playCount !== 1 && <span style={{ display: "block", fontSize: 11, color: "var(--cy)" }}>{c.playCount === 0 ? "loop" : `×${c.playCount}`}</span>}
                  {measured[c.id] !== undefined && <span style={{ display: "block", fontSize: 11, color: "var(--amb)" }} title="Measured in rehearsal">reh {fmtTime(measured[c.id])}</span>}
                  {c.swappedFrom && <span style={{ display: "block", fontSize: 10.5, color: "var(--amb)", fontWeight: 600 }}>SWAPPED</span>}
                </span>
                <button className="b btn btn-icon" tabIndex={-1} aria-label="Preview in headphones" title="Preview in the headphones (H)"
                  onClick={(e) => { e.stopPropagation(); previewToggle(c); }}
                  style={{ height: 34, width: 34, background: previewId === c.id ? "var(--st)" : "var(--p3)", color: previewId === c.id ? "var(--bg)" : "var(--st)", fontWeight: 800 }}>
                  {previewId === c.id ? "■" : "H"}
                </button>
                <button className="b btn" tabIndex={-1} onClick={(e) => { e.stopPropagation(); useUi.getState().openDialog({ kind: "swap", cueId: c.id }); }} style={{ height: 34 }} title="Emergency swap: replace this cue's audio">Swap</button>
                {!standby && (
                  <>
                    <button className="b btn" tabIndex={-1} onClick={(e) => { e.stopPropagation(); skipTo(c.id); }} style={{ height: 34 }} title="Move the playhead here (nothing is reordered)">Skip to</button>
                    <button className="b btn" tabIndex={-1} onClick={(e) => { e.stopPropagation(); void makeNext(c.id, playhead); }} style={{ height: 34, color: "var(--acc)", fontWeight: 700 }} title="Move this cue in front of the one standing by">Make next</button>
                  </>
                )}
              </div>
            </div>
          );
        })}
        {!rows.length && (
          <div style={{ padding: 16, color: "var(--mute)", fontSize: 14 }}>{search ? `No cue matches “${search}”.` : "Nothing left: the show is done."}</div>
        )}
      </div>
    </section>
  );
}
