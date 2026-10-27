// In Run, dialogs open INSIDE the show screen instead of over all of it: the small ones (Make next)
// over the up-next list, the bigger ones (Swap, Settings) over the rail + now playing + up next.
// GO, STOP ALL, PANIC and the dock stay visible and clickable on the right.
//
// RunView marks the two areas with <RunDialogArea name="…">; a dialog wrapped in <InRun area="…">
// renders into that area while Run is on screen, and normally everywhere else.

import { useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { useDoc } from "../store";
import { useSettings } from "../settingsStore";

type Area = "list" | "main";

const useHosts = create<{ hosts: Partial<Record<Area, HTMLElement | null>>; set: (a: Area, el: HTMLElement | null) => void }>((set) => ({
  hosts: {},
  set: (a, el) => set((s) => (s.hosts[a] === el ? s : { hosts: { ...s.hosts, [a]: el } })),
}));

/** An area of the Run screen that dialogs can open in (fills its positioned parent). */
export function RunDialogArea({ name }: { name: Area }) {
  const set = useHosts((s) => s.set);
  // A stable ref callback: Run re-renders ~30× a second, and a new callback each time would
  // unmount and remount any open dialog.
  const ref = useCallback((el: HTMLDivElement | null) => set(name, el), [name, set]);
  return <div className="run-host" ref={ref} />;
}

/** Renders its dialog in a Run area while Run is showing; otherwise as usual (full window). */
export function InRun({ area, children }: { area: Area; children: ReactNode }) {
  const mode = useDoc((s) => s.mode);
  const dumbo = useSettings((s) => s.ui.dumbo);
  const host = useHosts((s) => s.hosts[area]);
  if (mode === "run" && !dumbo && host) return createPortal(children, host);
  return <>{children}</>;
}
