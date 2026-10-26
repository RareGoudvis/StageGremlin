// "Is there a newer StageGremlin?" The core asks GitHub (src-tauri/src/updates.rs); this keeps the
// answer for the banner and Settings › About. Nothing installs by itself: the operator downloads the
// new build from the release page, between shows.

import { create } from "zustand";
import { call, isTauri } from "./tauri";

export interface UpdateInfo {
  current: string | null;
  latest: string | null;
  url: string | null;
  newer: boolean;
}

interface UpdateStore {
  info: UpdateInfo | null;
  checking: boolean;
  error: string | null;
  /** The banner was closed for this release (until the app restarts). */
  dismissed: string | null;
  check: () => Promise<void>;
  dismiss: () => void;
}

export const useUpdates = create<UpdateStore>((set, get) => ({
  info: null,
  checking: false,
  error: null,
  dismissed: null,
  check: async () => {
    if (!isTauri || get().checking) return;
    set({ checking: true, error: null });
    try {
      set({ info: await call("app_check_update") });
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ checking: false });
    }
  },
  dismiss: () => set({ dismissed: get().info?.latest ?? null }),
}));

/** Check once, a little after start (no hurry; don't compete with opening the show). */
export function checkForUpdatesSoon() {
  window.setTimeout(() => void useUpdates.getState().check(), 8000);
}

export function openReleasePage(url: string) {
  call("open_release_page", { url }).catch((e) => console.warn("[updates]", e));
}

/** "v0.1.0-build.10" → "build 10" for people; anything else as it is. */
export function buildLabel(tag: string | null): string {
  const m = tag?.match(/-build\.(\d+)$/);
  return m ? `build ${m[1]}` : tag ?? "dev";
}
