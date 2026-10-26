// Tiny inline icons (no icon library needed offline).

import type { ReactNode } from "react";

type P = { size?: number };

export const Moon = ({ size = 16 }: P) => (
  <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
    <path d="M15.5 12.6A6.5 6.5 0 0 1 7.4 4.5a6.5 6.5 0 1 0 8.1 8.1z" fill="currentColor" />
  </svg>
);

export const Sun = ({ size = 16 }: P) => (
  <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
    <circle cx="10" cy="10" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
    <path d="M10 2v2.4M10 15.6V18M2 10h2.4M15.6 10H18M4.3 4.3l1.7 1.7M14 14l1.7 1.7M4.3 15.7 6 14M14 6l1.7-1.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

/** Half sun, half moon: "automatic" theme. */
export const Auto = ({ size = 16 }: P) => (
  <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
    <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.8" />
    <path d="M10 3a7 7 0 0 1 0 14z" fill="currentColor" />
  </svg>
);

export const Chevron = ({ open, size = 12 }: P & { open: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" style={{ transform: open ? "none" : "rotate(-90deg)", transition: "transform .12s", flex: "none" }}>
    <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="var(--acc)" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

/** Arrow used for "follow": next cue starts by itself. */
export const Follow = ({ size = 14 }: P) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3 4v4a3 3 0 0 0 3 3h7m-3-3 3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const Grip = ({ size = 14 }: P) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
    {[4, 8, 12].map((y) => (
      <g key={y}>
        <circle cx="6" cy={y} r="1.2" fill="currentColor" />
        <circle cx="10" cy={y} r="1.2" fill="currentColor" />
      </g>
    ))}
  </svg>
);

export const Search = ({ size = 14 }: P) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export const Gear = ({ size = 16 }: P) => (
  <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
    <circle cx="10" cy="10" r="2.8" fill="none" stroke="currentColor" strokeWidth="1.8" />
    <path d="M10 2.5v2.2M10 15.3v2.2M2.5 10h2.2M15.3 10h2.2M4.7 4.7l1.6 1.6M13.7 13.7l1.6 1.6M4.7 15.3l1.6-1.6M13.7 6.3l1.6-1.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

// ---- Build rail, toolbar and selection bar (24-unit stroke icons, same look as the mockup) ----

const Stroke = ({ size = 16, width = 2, children }: P & { width?: number; children: ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const ListIcon = ({ size = 20 }: P) => <Stroke size={size}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></Stroke>;
export const PadsIcon = ({ size = 20 }: P) => (
  <Stroke size={size}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
  </Stroke>
);
export const FolderIcon = ({ size = 20 }: P) => <Stroke size={size}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></Stroke>;
export const Plus = ({ size = 16 }: P) => <Stroke size={size} width={2.4}><path d="M12 5v14M5 12h14" /></Stroke>;
export const Close = ({ size = 14 }: P) => <Stroke size={size} width={2.4}><path d="M18 6L6 18M6 6l12 12" /></Stroke>;
export const UndoIcon = ({ size = 16 }: P) => <Stroke size={size}><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></Stroke>;
export const RedoIcon = ({ size = 16 }: P) => <Stroke size={size}><path d="M15 14l5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></Stroke>;
export const Caret = ({ size = 14 }: P) => <Stroke size={size}><path d="M6 9l6 6 6-6" /></Stroke>;
export const Upload = ({ size = 32 }: P) => <Stroke size={size} width={1.8}><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></Stroke>;
