// Small form controls used by the inspector. They keep the inspector code short and consistent.

import { useEffect, useState, type ReactNode } from "react";

/**
 * A labelled row: label on the left, control(s) on the right.
 * `stack`: label above, control on the full width below (for choices that don't fit next to a label).
 */
export function Row({ label, children, hint, stack }: { label: string; children: ReactNode; hint?: string; stack?: boolean }) {
  if (stack) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }} title={hint}>
        <span style={{ fontSize: 13, color: "var(--dim)" }}>{label}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flexWrap: "wrap" }}>{children}</div>
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "92px minmax(0, 1fr)", alignItems: "center", gap: 8 }} title={hint}>
      <span style={{ fontSize: 13, color: "var(--dim)" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flexWrap: "wrap" }}>{children}</div>
    </div>
  );
}

/** A titled block in the inspector. */
export function Group({ title, color, children, right }: { title: string; color?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="k" style={{ color, marginRight: "auto" }}>{title}</span>
        {right}
      </div>
      {children}
    </section>
  );
}

/**
 * Toggle chips: one of several options, drawn as one segmented control (see .chips in styles.css).
 * `fill`: stretch to the full width, every option the same width (never wraps).
 */
export function Chips<T>({ options, value, onChange, label, fill }: {
  options: { value: T; label: string; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  fill?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className={fill ? "chips chips-fill" : "chips"}>
      {options.map((o) => (
        <button key={String(o.value)} className="b chip" aria-pressed={o.value === value} title={o.title} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A number box that commits on Enter / leaving the field (not on every keystroke,
 * so half-typed values like "-" don't reach the show). Arrow keys nudge by `step`.
 */
export function NumField({ value, onChange, step = 0.1, min, max, unit, width = 72, digits = 1, label }: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  width?: number;
  digits?: number;
  label: string;
}) {
  const shown = value.toFixed(digits);
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setDraft(null), [shown]);
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const commit = (text: string) => {
    const v = Number(text.replace(",", ".").replace("−", "-"));
    if (Number.isFinite(v)) onChange(clamp(Number(v.toFixed(digits + 1))));
    setDraft(null);
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <input
        className="input mono"
        aria-label={label}
        value={draft ?? shown}
        style={{ width, textAlign: "right", height: 30 }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => draft !== null && commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
          if (e.key === "Escape") setDraft(null);
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            onChange(clamp(Number((value + (e.key === "ArrowUp" ? step : -step)).toFixed(digits + 1))));
          }
        }}
      />
      {unit && <span className="mono" style={{ fontSize: 12, color: "var(--mute)" }}>{unit}</span>}
    </span>
  );
}

/** A range slider with its value printed next to it. */
export function Slider({ value, onChange, min, max, step, format, label }: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  label: string;
}) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
      <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} onDoubleClick={() => onChange(0)} title="Double-click to reset" />
      <span className="mono" style={{ fontSize: 12.5, width: 64, textAlign: "right", flex: "none" }}>{format(value)}</span>
    </span>
  );
}

/** A text field that commits on every keystroke (undo steps are merged by the store). */
export function TextField({ value, onChange, label, multiline, color, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  multiline?: boolean;
  color?: string;
  placeholder?: string;
}) {
  return multiline ? (
    <textarea className="textarea" aria-label={label} rows={2} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={{ color, width: "100%" }} />
  ) : (
    <input className="input" aria-label={label} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={{ width: "100%" }} />
  );
}
