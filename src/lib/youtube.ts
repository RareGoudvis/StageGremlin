// YouTube downloads: progress per item (from yt://progress) and a promise-based
// helper so the swap dialog can "resolve + download one link" and wait for the file.

import { create } from "zustand";
import type { YtFormat, YtItem, YtProgress } from "../types";
import { call } from "./tauri";
import { mediaDestDir } from "./fileActions";
import { tr } from "../i18n";

interface YtStore {
  progress: Record<string, YtProgress>;
  onProgress: (p: YtProgress) => void;
  clear: (ids: string[]) => void;
}

const waiters = new Map<string, { resolve: (file: string) => void; reject: (e: Error) => void }>();

export const useYt = create<YtStore>((set) => ({
  progress: {},
  onProgress: (p) => {
    set((s) => ({ progress: { ...s.progress, [p.id]: p } }));
    const w = waiters.get(p.id);
    if (w && p.status === "done" && p.file) { waiters.delete(p.id); w.resolve(p.file); }
    if (w && p.status === "error") { waiters.delete(p.id); w.reject(new Error(p.error ?? tr("b.yt.downloadFailed"))); }
  },
  clear: (ids) =>
    set((s) => {
      const progress = { ...s.progress };
      for (const id of ids) delete progress[id];
      return { progress };
    }),
}));

export async function ytDownload(items: YtItem[], format: YtFormat) {
  await call("yt_download", {
    items: items.map((i) => ({ id: i.id, url: i.url, title: i.title })),
    format,
    destDir: await mediaDestDir(),
  });
}

/** Resolve one link or "artist – title" line and download it (original audio). Resolves with the file path. */
export async function ytFetchOne(line: string): Promise<{ file: string; item: YtItem }> {
  const items = await call("yt_resolve", { lines: [line] });
  const item = items.find((i) => !i.error);
  if (!item) throw new Error(items[0]?.error ?? tr("b.yt.nothingFound"));
  const done = new Promise<string>((resolve, reject) => waiters.set(item.id, { resolve, reject }));
  await ytDownload([item], "original");
  return { file: await done, item };
}
