// Build: edit the show. Left rail (Media · Cues · Pads), the foldable media sidebar, one toolbar
// (or the selection bar), the cue list or pads in the middle and the inspector on the right.

import { useEffect } from "react";
import { MediaBin } from "../components/build/MediaBin";
import { copyCues, cutCues, duplicateCues, pasteCues } from "../lib/clipboard";
import { isAction } from "../settingsStore";
import { useT } from "../i18n";
import { useDoc } from "../store";
import { useUi } from "../uiStore";
import { allCues } from "../types";
import { moveBy } from "../lib/showOps";
import { findAnyCue } from "../lib/showOps";
import { previewToggle } from "../lib/preview";
import { PadGrid } from "../components/build/PadGrid";
import { CueList } from "../components/build/CueList";
import { Inspector, deleteCues } from "../components/build/Inspector";
import { BuildRail } from "../components/build/BuildRail";
import { BuildToolbar } from "../components/build/BuildToolbar";
import { SelectionBar } from "../components/build/SelectionBar";

export function BuildView() {
  useBuildKeys();
  const t = useT();
  const tab = useDoc((s) => s.buildTab);
  const multi = useDoc((s) => s.selection.length > 1);
  const binOpen = useUi((s) => s.binOpen);
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
      <BuildRail />
      {binOpen && <MediaBin />}
      <section aria-label="Show" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {multi && tab === "cues" ? <SelectionBar /> : <BuildToolbar />}
        {tab === "cues" ? <CueList /> : <PadGrid />}
        {tab === "cues" && (
          <p style={{ margin: 0, padding: "8px 20px", fontSize: 12, color: "var(--mute)", borderTop: "1px solid var(--line)" }}>{t("build.tip")}</p>
        )}
      </section>
      <Inspector />
    </div>
  );
}

/**
 * Keys for the cue list: ↑/↓ select, Alt+↑/↓ move, Delete removes, Ctrl+A selects all,
 * Enter opens the cue editor, H previews in the headphones.
 */
function useBuildKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const ui = useUi.getState();
      if (t.closest("input, textarea, select") || ui.confirm || ui.editorCueId || ui.dialog) return;
      const s = useDoc.getState();
      const order = allCues(s.show).map((c) => c.id);
      const current = s.buildTab === "pads" ? s.show.pads.find((p) => p.id === s.selectedPad)?.cue : findAnyCue(s.show, s.primary);

      if (e.key.toLowerCase() === "h" && !e.ctrlKey && !e.altKey && current) {
        e.preventDefault();
        previewToggle(current);
        return;
      }
      if (e.key === "Enter" && current) {
        e.preventDefault();
        ui.openEditor(current.id);
        return;
      }
      if (s.buildTab !== "cues") return;

      // Ctrl+K: jump to the search field.
      if (isAction(e, "find")) {
        e.preventDefault();
        document.getElementById("cue-find")?.focus();
        return;
      }
      // Esc clears a multi-selection (the ✕ on the selection bar).
      if (e.key === "Escape" && s.selection.length > 1) {
        e.preventDefault();
        s.setSelection(s.primary ? [s.primary] : []);
        return;
      }

      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        if (s.selection.length) s.edit((show) => moveBy(show, s.selection, e.key === "ArrowUp" ? -1 : 1));
        return;
      }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const i = s.primary ? order.indexOf(s.primary) : -1;
        const j = Math.max(0, Math.min(order.length - 1, i + (e.key === "ArrowUp" ? -1 : 1)));
        if (order[j]) s.select(order[j], { shift: e.shiftKey });
        document.querySelector(`[data-cue-id="${order[j]}"]`)?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        void deleteCues(s.selection);
        return;
      }
      // Clipboard (rebindable in Settings).
      if (isAction(e, "cut")) { e.preventDefault(); cutCues(); return; }
      if (isAction(e, "copy")) { e.preventDefault(); copyCues(); return; }
      if (isAction(e, "paste")) { e.preventDefault(); pasteCues(); return; }
      if (isAction(e, "duplicate")) { e.preventDefault(); duplicateCues(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        s.setSelection(order);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
