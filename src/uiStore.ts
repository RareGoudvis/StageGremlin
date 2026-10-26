// Small, short-lived UI things: toasts and the in-app confirm dialog.
// An in-app dialog (instead of the OS one) keeps the look consistent and works in the browser too.

import { create } from "zustand";

export interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

/** Big dialogs; only one at a time. */
export type Dialog =
  /** The Add window: one place for audio files, YouTube & lists, pads and sections. */
  | { kind: "add"; tab?: AddTab }
  | { kind: "print" }
  | { kind: "swap"; cueId: string }
  | { kind: "resume" }
  /** `tab`: open Settings on that page (e.g. "tools" from the Add window's "Import settings…"). */
  | { kind: "settings"; tab?: string };

export type AddTab = "files" | "yt" | "pad";

/** Booth settings for a dark hall: dimmer, red night mode, Big mode. Remembered per machine. */
export interface Booth { dim: number; red: boolean; big: boolean }

interface UiStore {
  toast: { text: string; id: number } | null;
  confirm: ConfirmRequest | null;
  /** Cue (or pad cue) open in the big cue editor. */
  editorCueId: string | null;
  dialog: Dialog | null;
  booth: Booth;
  /** Build's search field: filters the cue list while not empty. */
  find: string;
  setFind: (find: string) => void;
  /** Build's media sidebar is open (remembered on this machine). */
  binOpen: boolean;
  setBinOpen: (open: boolean) => void;
  showToast: (text: string) => void;
  ask: (req: Omit<ConfirmRequest, "resolve">) => Promise<boolean>;
  answer: (ok: boolean) => void;
  openEditor: (cueId: string) => void;
  closeEditor: () => void;
  openDialog: (d: Dialog) => void;
  closeDialog: () => void;
  setBooth: (patch: Partial<Booth>) => void;
}

function loadBooth(): Booth {
  const def: Booth = { dim: 100, red: false, big: false };
  try {
    const raw = localStorage.getItem("cueplay.booth");
    return raw ? { ...def, ...JSON.parse(raw) } : def;
  } catch {
    return def;
  }
}

function loadBinOpen(): boolean {
  try {
    return localStorage.getItem("cueplay.bin") !== "closed";
  } catch {
    return true;
  }
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useUi = create<UiStore>((set, get) => ({
  toast: null,
  confirm: null,
  editorCueId: null,
  dialog: null,
  booth: loadBooth(),
  find: "",
  setFind: (find) => set({ find }),
  binOpen: loadBinOpen(),
  setBinOpen: (binOpen) => {
    try {
      localStorage.setItem("cueplay.bin", binOpen ? "open" : "closed");
    } catch {
      // not remembered; still applies now
    }
    set({ binOpen });
  },
  showToast: (text) => {
    const id = Date.now();
    set({ toast: { text, id } });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null });
    }, 2600);
  },
  ask: (req) =>
    new Promise<boolean>((resolve) => {
      get().confirm?.resolve(false); // only one dialog at a time
      set({ confirm: { ...req, resolve } });
    }),
  answer: (ok) => {
    const c = get().confirm;
    set({ confirm: null });
    c?.resolve(ok);
  },
  openEditor: (editorCueId) => set({ editorCueId }),
  closeEditor: () => set({ editorCueId: null }),
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
  setBooth: (patch) => {
    const booth = { ...get().booth, ...patch };
    try {
      localStorage.setItem("cueplay.booth", JSON.stringify(booth));
    } catch {
      // Not remembered; still applies now.
    }
    set({ booth });
  },
}));

export const toast = (text: string) => useUi.getState().showToast(text);
export const ask = (req: Omit<ConfirmRequest, "resolve">) => useUi.getState().ask(req);
