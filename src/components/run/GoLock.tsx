// GO lock-out on the GO buttons (Run, Big mode, Dumbo mode): right after a GO the button goes pale and a
// bar along its bottom runs out; while it runs, GO does nothing (the engine ignores it, see runActions.useGoLock).
// Very short locks (under half a second) only stop a nervous double tap and are not drawn.

import { useEffect, useState } from "react";
import { useGoLock } from "../../lib/runActions";

const DRAW_FROM_MS = 500;

/** True while GO is locked (and long enough to be worth showing). Re-renders when the lock ends. */
export function useGoLocked(): boolean {
  const { at, ms } = useGoLock();
  const [, rerender] = useState(0);
  const left = at + ms - performance.now();
  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => rerender((n) => n + 1), left + 20);
    return () => clearTimeout(id);
  }, [at, ms, left > 0]);
  return left > 0 && ms >= DRAW_FROM_MS;
}

/** The bar that runs out. Put it inside the GO button (the button needs position: relative). */
export function GoLockBar() {
  const { at, ms } = useGoLock();
  const locked = useGoLocked();
  if (!locked) return null;
  // Start the animation part-way when the button appears mid-lock (e.g. after switching screens).
  const done = Math.min(ms, performance.now() - at);
  return (
    <span aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 10, background: "rgba(0, 0, 0, .12)" }}>
      <span key={at} style={{ display: "block", height: "100%", background: "currentColor", opacity: 0.55, animation: `golock ${ms}ms linear forwards`, animationDelay: `-${done}ms` }} />
    </span>
  );
}
