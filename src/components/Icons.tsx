// Tiny inline icons (no icon library needed offline).

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
