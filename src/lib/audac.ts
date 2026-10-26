// AUDAC MTX88 remote: commands, live state and the per-laptop setup (IP address, zone and input names).
// The core holds the one network connection the MTX allows (src-tauri/src/audac). In a plain browser
// a small simulator answers instead, so the panel can be designed without the box.

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "./tauri";
import { useSettings, type AudacSetup } from "../settingsStore";

export type AudacStatus = "off" | "connecting" | "connected" | "retrying";

export interface AudacZone {
  /** dB below maximum: 0 = loudest, 70 = quietest. */
  volume: number;
  /** 1–8 (MTX input list), 0 = none. */
  input: number;
  mute: boolean;
}

export interface AudacState {
  status: AudacStatus;
  host: string;
  port: number;
  message: string | null;
  /** False until the MTX has reported its zones once. */
  known: boolean;
  zones: AudacZone[];
}

export const MIN_VOLUME = 70;

/** The pretend MTX answers in a browser, and in the app when Settings › AUDAC › Demo is on. */
const simulated = () => !isTauri || useSettings.getState().ui.audac.demo;

async function cmd<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (!simulated()) return invoke<T>(name, args);
  return sim.handle(name, args) as T;
}

/** Switch the demo on or off: let go of the real MTX first, then connect to whichever is now in use. */
export async function setAudacDemo(on: boolean) {
  await audac.disconnect().catch(() => {});
  const s = useSettings.getState();
  s.update({ audac: { ...s.ui.audac, demo: on } });
  if (on || s.ui.audac.autoConnect) audacConnectSaved();
}

/** One function per Tauri command (docs/ipc.md, "AUDAC"). Zones and inputs count from 1. */
export const audac = {
  connect: (host: string, port: number) => cmd<void>("audac_connect", { host, port }),
  disconnect: () => cmd<void>("audac_disconnect"),
  getState: () => cmd<AudacState>("audac_get_state"),
  setVolume: (zone: number, db: number) => cmd<void>("audac_set_volume", { zone, db: Math.round(db) }),
  step: (zone: number, up: boolean) => cmd<void>("audac_step_volume", { zone, up }),
  setInput: (zone: number, input: number) => cmd<void>("audac_set_input", { zone, input }),
  setMute: (zone: number, mute: boolean) => cmd<void>("audac_set_mute", { zone, mute }),
};

/** Connect with this laptop's saved address (or to the pretend MTX in demo). */
export function audacConnectSaved() {
  const a = useSettings.getState().ui.audac;
  const host = a.demo ? "demo" : a.host.trim();
  if (host) audac.connect(host, a.port).catch((e) => console.warn("[audac]", e));
}

/** Live state from `audac://state`. */
export function useAudac(): AudacState | null {
  const [state, setState] = useState<AudacState | null>(null);
  // Re-subscribe when the demo is switched: the state then comes from the other source.
  const demo = useSettings((s) => s.ui.audac.demo);
  useEffect(() => {
    let alive = true;
    let stop: (() => void) | null = null;
    audac.getState().then((s) => alive && setState(s)).catch(() => {});
    if (isTauri && !demo) {
      listen<AudacState>("audac://state", (e) => setState(e.payload)).then((un) => (alive ? (stop = un) : un()));
    } else {
      stop = sim.subscribe((s) => alive && setState(s));
    }
    return () => {
      alive = false;
      stop?.();
    };
  }, [demo]);
  return state;
}

/** Connect at start when this laptop is set up for it (call once from App). */
export function useAudacAutoConnect() {
  const loaded = useSettings((s) => s.loaded);
  useEffect(() => {
    const a = useSettings.getState().ui.audac;
    if (loaded && a.autoConnect && (a.host.trim() || a.demo)) audacConnectSaved();
  }, [loaded]);
}

/** Is an MTX set up on this laptop? (The AUDAC pill and dock tab only show when it is.) */
export function useAudacConfigured(): boolean {
  return useSettings((s) => !!s.ui.audac.host.trim() || s.ui.audac.demo);
}

/** The zones / inputs this laptop chose to show, with their names (1-based numbers). */
export function visible(list: AudacSetup["zones"]): { n: number; name: string }[] {
  return list.map((x, i) => ({ n: i + 1, name: x.name || `${i + 1}`, show: x.show })).filter((x) => x.show);
}

// ---- browser simulator: behaves like an MTX that is always there ----

const sim = (() => {
  let state: AudacState = {
    status: "off", host: "", port: 5001, message: null, known: false,
    zones: Array.from({ length: 8 }, (_, i) => ({ volume: 30, input: i === 0 ? 4 : 3, mute: false })),
  };
  const subs = new Set<(s: AudacState) => void>();
  const set = (patch: Partial<AudacState>) => {
    state = { ...state, ...patch };
    subs.forEach((f) => f(state));
  };
  const zone = (z: number, patch: Partial<AudacZone>) => set({ zones: state.zones.map((x, i) => (i === z - 1 ? { ...x, ...patch } : x)) });
  return {
    subscribe(f: (s: AudacState) => void) {
      subs.add(f);
      return () => void subs.delete(f);
    },
    handle(name: string, a: Record<string, unknown> = {}): unknown {
      switch (name) {
        case "audac_get_state": return state;
        case "audac_connect":
          set({ status: "connecting", host: String(a.host), port: Number(a.port) });
          setTimeout(() => set({ status: "connected", known: true }), 400);
          return;
        case "audac_disconnect": return set({ status: "off", known: false });
        case "audac_set_volume": return zone(Number(a.zone), { volume: Number(a.db) });
        case "audac_step_volume": {
          const z = state.zones[Number(a.zone) - 1];
          return zone(Number(a.zone), { volume: Math.max(0, Math.min(MIN_VOLUME, z.volume + (a.up ? -3 : 3))) });
        }
        case "audac_set_input": return zone(Number(a.zone), { input: Number(a.input) });
        case "audac_set_mute": return zone(Number(a.zone), { mute: !!a.mute });
      }
    },
  };
})();
