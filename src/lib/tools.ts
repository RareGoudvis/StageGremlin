// yt-dlp and ffmpeg: whether they're installed and installing them.
// Nothing is bundled with the app; they're downloaded into <dataDir>/bin on request.

import { create } from "zustand";
import type { YtInstallProgress, YtStatus, YtTool } from "../types";
import { call } from "./tauri";
import { toast } from "../uiStore";
import { tr } from "../i18n";

interface ToolsStore {
  status: YtStatus | null;
  installing: Partial<Record<YtTool, number>>; // percent while installing
  refresh: () => Promise<YtStatus | null>;
  install: (what: YtTool) => Promise<void>;
  onProgress: (p: YtInstallProgress) => void;
}

export const TOOL_NAME: Record<YtTool, string> = { ytDlp: "yt-dlp", ffmpeg: "ffmpeg" };

export const useTools = create<ToolsStore>((set, get) => ({
  status: null,
  installing: {},
  refresh: async () => {
    try {
      const status = await call("yt_status");
      set({ status });
      return status;
    } catch (e) {
      console.warn("[cueplay] yt_status", e);
      return null;
    }
  },
  install: async (what) => {
    set((s) => ({ installing: { ...s.installing, [what]: 0 } }));
    try {
      await call("yt_install", { what });
    } catch (e) {
      toast(tr("m.tool.failed", { tool: TOOL_NAME[what], e: String(e) }));
      set((s) => ({ installing: { ...s.installing, [what]: undefined } }));
    }
  },
  onProgress: (p) => {
    if (p.done || p.error) {
      set((s) => ({ installing: { ...s.installing, [p.what]: undefined } }));
      if (p.error) toast(tr("m.tool.failed", { tool: TOOL_NAME[p.what], e: p.error }));
      else toast(tr("m.tool.installed", { tool: TOOL_NAME[p.what] }));
      void get().refresh();
    } else {
      set((s) => ({ installing: { ...s.installing, [p.what]: p.percent } }));
    }
  },
}));

export function hasTool(s: YtStatus | null, what: YtTool): boolean {
  return what === "ytDlp" ? !!s?.ytDlp : !!s?.ffmpeg;
}
