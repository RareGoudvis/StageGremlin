// Background settings live in the show (`show.background`), so a show file brings its own
// duck level, fade times and offsets. This file keeps the Rust side in step with the document:
//
// - whenever `show.background` changes (open, edit, undo/redo), its config is sent with bg_set_config
// - the Build panel writes changes into the show through `saveBackgroundToShow`
//
// A show without `background` (a new or older show) keeps whatever the core has now, which is
// the per-machine default from <dataDir>/background.json.
//
// Imported for its side effect by BackgroundDock and BackgroundPanel, which are always loaded.

import { useDoc } from "../../store";
import { bg, bgDo, DEFAULT_CONFIG, type BgConfig, type BgSource } from "./useBackground";

/** What we store in `show.background`. */
export interface ShowBackground {
  config: BgConfig;
  /** The source used last with this show (informational: the player isn't opened automatically). */
  source: BgSource | null;
}

/** Reads `show.background` defensively: it is free JSON, an old or hand-edited file may differ. */
export function readShowBackground(raw: unknown): ShowBackground | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<ShowBackground>;
  if (!r.config || typeof r.config !== "object") return null;
  const c = r.config as Partial<BgConfig>;
  return {
    config: { ...DEFAULT_CONFIG, ...c, offsets: { ...DEFAULT_CONFIG.offsets, ...(c.offsets ?? {}) } },
    source: r.source ?? null,
  };
}

/** Writes background settings into the show (one undo step per slider drag). */
export function saveBackgroundToShow(patch: Partial<ShowBackground>) {
  const doc = useDoc.getState();
  const current = readShowBackground(doc.show.background);
  const next: ShowBackground = {
    config: patch.config ?? current?.config ?? DEFAULT_CONFIG,
    source: patch.source !== undefined ? patch.source : current?.source ?? null,
  };
  doc.edit((s) => ({ ...s, background: next }), { coalesce: "background" });
}

let lastSent: unknown = undefined;

function sync(raw: unknown) {
  if (raw === lastSent) return;
  lastSent = raw;
  const b = readShowBackground(raw);
  if (b) bgDo(bg.setConfig(b.config));
}

sync(useDoc.getState().show.background);
useDoc.subscribe((s) => sync(s.show.background));
