// Small building blocks shared by the Settings pages.

import type { ReactNode } from "react";
import { useDoc } from "../../store";
import type { ShowSettings } from "../../types";

/** Page title plus one line saying where these settings are stored. */
export function PageTitle({ children, note }: { children: ReactNode; note?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>{children}</h1>
      {note && <span style={{ fontSize: 13, color: "var(--dim)" }}>{note}</span>}
    </div>
  );
}

/** A white block that groups related settings. */
export function Card({ children, title, note }: { children: ReactNode; title?: string; note?: string }) {
  return (
    <section style={{ background: "var(--p1)", border: "1px solid var(--line)", borderRadius: 14, padding: "18px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
      {title && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>{title}</span>
          {note && <span style={{ fontSize: 13, color: "var(--dim)" }}>{note}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Edit one field of show.settings (saved with the show file). */
export function useShowSetting() {
  const settings = useDoc((s) => s.show.settings);
  const set = (patch: Partial<ShowSettings>, key?: string) =>
    useDoc.getState().edit((s) => ({ ...s, settings: { ...s.settings, ...patch } }), key ? { coalesce: `settings:${key}` } : undefined);
  return { settings, set };
}
