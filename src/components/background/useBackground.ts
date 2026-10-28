// Background music player: types, commands and the live state hook.
// Contract: docs/ipc-wave2.md → "Background player". Rust side: src-tauri/src/background/.
//
// Outside the desktop app (npm run dev in a browser) a small simulator answers instead,
// so the dock looks alive while designing.

import { useSettings } from "../../settingsStore";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "../../lib/tauri";

export type BgSource = "spotify" | "ytmusic" | "beatport" | "soundtrack" | "soundcloud" | "youtube";
export type BgCmd = "duck" | "restore" | "play" | "pause" | "next" | "prev";

export interface BgConfig {
  duckDb: number;
  duckTime: number;
  restoreTime: number;
  restoreHold: number;
  autoDuck: boolean;
  offsets: Record<BgSource, number>;
}

export interface BgState {
  source: BgSource | null;
  open: boolean;
  visible: boolean;
  playing: boolean;
  title: string | null;
  artist: string | null;
  position: number | null;
  duration: number | null;
  levelDb: number;
  ducked: boolean;
  sessionFound: boolean;
  error: string | null;
  /** Rows the page shows (playlist / queue), best effort. null = not available for this source. */
  tracks: BgTrack[] | null;
  /** Services with a player window open (each keeps playing on its own). */
  openSources?: BgSource[];
  /** Every service that reported, with its own state and fader. */
  players?: PlayerState[];
  /** Deck A and B (null = empty), and which is on air (0 = A, 1 = B). */
  decks?: [BgSource | null, BgSource | null];
  onAir?: number;
  /** One shared engine for all services: no separate faders, swaps pause/start. */
  lowSpec?: boolean;
}

export interface PlayerState {
  source: BgSource;
  playing: boolean;
  title: string | null;
  artist: string | null;
  position: number | null;
  duration: number | null;
  /** Its own fader (dB, 0 = full, −60 = off). */
  levelDb: number;
  /** Faded out (crossfaded away, or paused with a fade). */
  held: boolean;
  /** Someone signed in to the service in this player? null = can't tell (yet). */
  signedIn?: boolean | null;
}

export interface BgTrack { title: string; artist: string | null }

export const SOURCES: { id: BgSource; label: string }[] = [
  { id: "spotify", label: "Spotify" },
  { id: "ytmusic", label: "YouTube Music" },
  { id: "beatport", label: "Beatport" },
  { id: "soundtrack", label: "Soundtrack" },
  { id: "soundcloud", label: "SoundCloud" },
  { id: "youtube", label: "YouTube" },
];

export const DEFAULT_CONFIG: BgConfig = {
  duckDb: -30, duckTime: 1.5, restoreTime: 3, restoreHold: 2, autoDuck: true,
  offsets: { spotify: 0, ytmusic: 0, beatport: -6, soundtrack: 0, soundcloud: 0, youtube: 0 },
};

/** The services this laptop offers (Settings › Background music); the rest are hidden everywhere. */
export function useEnabledSources(): { id: BgSource; label: string }[] {
  const ids = useSettings((s) => s.ui.bgServices);
  return SOURCES.filter((s) => ids.includes(s.id));
}

// ---- commands (one function per Tauri command) ----

async function cmd<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri) return invoke<T>(name, args);
  return mockCmd(name, args) as T;
}

export const bg = {
  /** `link`: a playlist page on that service instead of its start page. */
  open: (source: BgSource, show: boolean, link?: string) => cmd<void>("bg_open", { source, show, link: link ?? null }),
  hide: () => cmd<void>("bg_hide"),
  /** `source`: one deck's service; without it, the active player (as in Run). */
  command: (c: BgCmd, instant = false, source?: BgSource) => cmd<void>("bg_command", { cmd: c, instant, source: source ?? null }),
  setDeck: (deck: 0 | 1, source: BgSource | null) => cmd<void>("bg_set_deck", { deck, source }),
  /** The on-air deck fades out, the other fades in; `secs` 0 = cut. */
  crossfade: (secs: number) => cmd<void>("bg_crossfade", { secs }),
  setFader: (source: BgSource, db: number) => cmd<void>("bg_set_fader", { source, db }),
  setLowSpec: (on: boolean) => cmd<void>("bg_set_low_spec", { on }),
  setLevel: (db: number) => cmd<void>("bg_set_level", { db }),
  setConfig: (config: BgConfig) => cmd<void>("bg_set_config", { config }),
  getState: () => cmd<BgState>("bg_get_state"),
  getConfig: () => cmd<BgConfig>("bg_get_config"),
  playTrack: (index: number, title: string) => cmd<void>("bg_play_track", { index, title }),
  /** Close one service's window (its music stops). */
  close: (source: BgSource) => cmd<void>("bg_close", { source }),
  /** Background screen: put the player over `rect` (physical px inside the main window), or null to take it away. */
  dock: (rect: { x: number; y: number; w: number; h: number } | null) => cmd<void>("bg_dock", { rect }),
};

// ---- keyboard (Run) ----

/**
 * Background keys in Run: D duck · R restore · Shift+D play/pause · Shift+→ next ·
 * Alt+D / Alt+R the same without a fade. They work even when the dock is locked (the lock only
 * guards against mis-taps). Returns true when the key was ours.
 */
export function backgroundKey(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey) return false;
  const instant = e.altKey;
  if (e.code === "KeyD" && e.shiftKey) {
    // Play/pause toggles, so ask the core what it is doing right now (the dock may not be open).
    bgDo(bg.getState().then((st) => bg.command(st.playing ? "pause" : "play", instant)));
    return true;
  }
  let c: BgCmd | null = null;
  if (e.code === "KeyD") c = "duck";
  else if (e.code === "KeyR" && !e.shiftKey) c = "restore";
  else if (e.key === "ArrowRight" && e.shiftKey) c = "next";
  if (!c) return false;
  bgDo(bg.command(c, instant));
  return true;
}

/** Runs a command and shows nothing on success; errors go to the console and the caller. */
export function bgDo(p: Promise<unknown>, onError?: (msg: string) => void) {
  p.catch((e) => {
    console.warn("[background]", e);
    onError?.(String(e));
  });
}

// ---- live state ----

/** The latest `bg://state` (about 4 times a second). null until the first one arrives. */
export function useBackground(): BgState | null {
  const [state, setState] = useState<BgState | null>(null);
  useEffect(() => {
    let stop: (() => void) | null = null;
    let alive = true;
    bg.getState().then((s) => alive && setState(s)).catch(() => {});
    if (isTauri) {
      listen<BgState>("bg://state", (e) => setState(e.payload)).then((un) => {
        if (alive) stop = un;
        else un();
      });
    } else {
      const t = window.setInterval(() => setState(mockTick()), 250);
      stop = () => window.clearInterval(t);
    }
    return () => {
      alive = false;
      stop?.();
    };
  }, []);
  return state;
}

// ---- browser simulator ----

const TRACKS = [
  { title: "Golden Hour", artist: "JVKE", duration: 209 },
  { title: "Dance Monkey", artist: "Tones and I", duration: 210 },
  { title: "Levitating", artist: "Dua Lipa", duration: 203 },
];

const sim = {
  state: {
    source: "spotify", open: true, visible: false, playing: true, title: TRACKS[0].title, artist: TRACKS[0].artist,
    position: 42, duration: TRACKS[0].duration, levelDb: 0, ducked: false, sessionFound: true, error: null,
    tracks: TRACKS.map((t) => ({ title: t.title, artist: t.artist })),
    decks: [null, null], onAir: 0, lowSpec: false, players: [], openSources: [],
  } as BgState,
  config: { ...DEFAULT_CONFIG, offsets: { ...DEFAULT_CONFIG.offsets } } as BgConfig,
  track: 0,
  last: Date.now(),
};

function setTrack(i: number) {
  sim.track = (i + TRACKS.length) % TRACKS.length;
  const t = TRACKS[sim.track];
  Object.assign(sim.state, { title: t.title, artist: t.artist, duration: t.duration, position: 0 });
}

function mockTick(): BgState {
  const now = Date.now();
  const s = sim.state;
  if (s.playing && s.position != null && s.duration != null) {
    s.position += (now - sim.last) / 1000;
    if (s.position >= s.duration) setTrack(sim.track + 1);
  }
  sim.last = now;
  return { ...s };
}

function mockCmd(name: string, args?: Record<string, unknown>): unknown {
  const s = sim.state;
  switch (name) {
    case "bg_open":
      s.source = args?.source as BgSource;
      s.open = true;
      s.visible = Boolean(args?.show);
      return;
    case "bg_hide":
      s.visible = false;
      return;
    case "bg_set_deck": {
      const d = [...(s.decks ?? [null, null])] as [BgSource | null, BgSource | null];
      d[Number(args?.deck)] = (args?.source as BgSource) ?? null;
      s.decks = d;
      const src = args?.source as BgSource | null;
      if (src && !s.players?.some((p) => p.source === src)) {
        s.players = [...(s.players ?? []), { source: src, playing: false, title: "Lunch Chill Mix", artist: "StudioRelax", position: 0, duration: 3600, levelDb: 0, held: true }];
        s.openSources = [...new Set([...(s.openSources ?? []), src])];
      }
      return;
    }
    case "bg_crossfade": {
      const [a, b] = s.decks ?? [null, null];
      const on = s.onAir ?? 0;
      const out = on === 0 ? a : b, inn = on === 0 ? b : a;
      s.players = s.players?.map((p) => (p.source === out ? { ...p, playing: false, held: true } : p.source === inn ? { ...p, playing: true, held: false } : p));
      s.onAir = 1 - on;
      return;
    }
    case "bg_set_fader":
      s.players = s.players?.map((p) => (p.source === args?.source ? { ...p, levelDb: Number(args?.db) } : p));
      return;
    case "bg_set_low_spec":
      s.lowSpec = Boolean(args?.on);
      return;
    case "bg_close":
    case "bg_dock":
      return; // a browser has no second window to place
    case "bg_command":
      // A deck: only that service's player.
      if (args?.source && (args.cmd === "play" || args.cmd === "pause")) {
        s.players = s.players?.map((p) => (p.source === args.source ? { ...p, playing: args.cmd === "play", held: args.cmd === "pause" } : p));
        return;
      }
      switch (args?.cmd as BgCmd) {
        case "duck": s.ducked = true; break;
        case "restore": s.ducked = false; break;
        case "play": s.playing = true; break;
        case "pause": s.playing = false; break;
        case "next": setTrack(sim.track + 1); break;
        case "prev": setTrack(sim.track - 1); break;
      }
      return;
    case "bg_set_level":
      s.levelDb = Number(args?.db ?? 0);
      return;
    case "bg_set_config":
      sim.config = args?.config as BgConfig;
      return;
    case "bg_get_state":
      return { ...s };
    case "bg_get_config":
      return sim.config;
    case "bg_play_track":
      setTrack(Number(args?.index ?? 0));
      s.playing = true;
      return;
  }
}
