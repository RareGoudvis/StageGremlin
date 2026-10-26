// The confirm dialog and the toast, drawn on top of every screen.

import { useEffect, useRef } from "react";
import { useUi } from "../uiStore";

export function ConfirmDialog() {
  const req = useUi((s) => s.confirm);
  const answer = useUi((s) => s.answer);
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!req) return;
    okRef.current?.focus();
    // Enter confirms, Esc cancels. Capture phase so Run's own keys (Space = GO) don't fire underneath.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); answer(false); }
      else if (e.key === "Enter") { e.preventDefault(); e.stopImmediatePropagation(); answer(true); }
      else if (e.key === " ") { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [req, answer]);

  if (!req) return null;
  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && answer(false)}>
      <div role="alertdialog" aria-label={req.title} className="dialog" style={{ borderColor: req.danger ? "var(--amb)" : "var(--line)" }}>
        <span className="cond" style={{ fontSize: 24, fontWeight: 800 }}>{req.title}</span>
        <span style={{ fontSize: 15, color: "var(--dim)", lineHeight: 1.4 }}>{req.body}</span>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="b btn" onClick={() => answer(false)} style={{ height: 40 }}>{req.cancelLabel ?? "Cancel"}</button>
          <button
            ref={okRef}
            className="b btn"
            onClick={() => answer(true)}
            style={{ height: 40, fontWeight: 800, background: req.danger ? "var(--amb)" : "var(--gobg)", color: req.danger ? "var(--onamb)" : "var(--ongo)" }}
          >
            {req.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Toast() {
  const t = useUi((s) => s.toast);
  if (!t) return null;
  return <div role="status" className="toast">{t.text}</div>;
}
