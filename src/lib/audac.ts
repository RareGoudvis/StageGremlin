// AUDAC MTX88 remote: commands, live state and the per-laptop setup (IP address, zone and input names).
// The core holds StageGremlin's network connection to the MTX (src-tauri/src/audac). In a plain browser
// a small simulator answers instead, so the panel can be designed without the box.

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "./tauri";
import { useSettings, type AudacSetup } from "../settingsStore";
import { applyMtxNames, DEFAULT_INPUT_NAMES, DEFAULT_ZONE_NAMES, mtxNames } from "./audacNames";
import type { GuardRule } from "./audacGroups";

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
  /** The 30 names stored on the MTX ("" until it has sent them; see lib/audacNames.ts). */
  names?: string[];
  /** Recent changes made by someone else (Touch 2, a wall panel…), newest last. */
  changes?: AudacChange[];
  /** How many of the 30 name questions the MTX answered since connecting. */
  namesAnswered?: number;
}

export interface AudacTalk {
  lines: string[];
  /** Other apps the MTX also answers, by the name tag they use (e.g. "web"). */
  others: { name: string; agoMs: number; lines: number }[];
  /** Level-meter lines received (not in `lines`). */
  vuLines: number;
}

/** Other apps active on the MTX in the last `withinMs` (polls while the caller is on screen). */
export function useOtherApps(withinMs = 30_000): string[] {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    const get = () => audac.talk().then((t) => setNames(t.others.filter((o) => o.agoMs < withinMs).map((o) => o.name)), () => {});
    get();
    const id = setInterval(get, 3000);
    return () => clearInterval(id);
  }, [withinMs]);
  return names;
}

export interface AudacChange {
  id: number;
  /** Milliseconds since 1970. */
  at: number;
  zone: number;
  what: "volume" | "input" | "mute";
  from: number;
  to: number;
  /** StageGremlin put it back (guarded zone). */
  restored: boolean;
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
  /** How each zone is protected against changes by someone else; [] = report only. */
  setGuard: (rules: GuardRule[]) => cmd<void>("audac_set_guard", { rules }),
  /** The last lines sent to (→) and heard from (←) the MTX, and the other apps it also answers. */
  talk: () => cmd<AudacTalk>("audac_talk"),
};

/**
 * "Find": mute the zone three times, briefly, then leave it as it was. With something playing,
 * you hear which room drops out.
 */
export function findZone(zone: number, mutedNow: boolean) {
  const steps = [!mutedNow, mutedNow, !mutedNow, mutedNow, !mutedNow, mutedNow];
  steps.forEach((m, i) => setTimeout(() => void audac.setMute(zone, m).catch(() => {}), i * 450));
}

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

/**
 * When the MTX sends its own names, fill in every zone and input that still has its factory name
 * here ("Zone 3", "Line 4"). Names typed in StageGremlin are never overwritten (call once from App).
 */
export function useAudacNameFill() {
  const st = useAudac();
  const names = st?.names;
  useEffect(() => {
    const got = mtxNames(names);
    if (!got) return;
    const a = useSettings.getState().ui.audac;
    const zones = applyMtxNames(a.zones, got.zones, DEFAULT_ZONE_NAMES, true);
    const inputs = applyMtxNames(a.inputs, got.inputs, DEFAULT_INPUT_NAMES, true);
    if (JSON.stringify(zones) !== JSON.stringify(a.zones) || JSON.stringify(inputs) !== JSON.stringify(a.inputs)) {
      useSettings.getState().update({ audac: { ...a, zones, inputs } });
    }
  }, [names]);
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
    names: Array.from({ length: 30 }, () => ""),
    changes: [],
  };
  let guarded: number[] = [];
  let nextId = 1;
  /** Demo: "a colleague with Touch 2" switches zone 2 to input 7 a few seconds after connecting. */
  let demoDone = false;
  const someoneElse = () => {
    if (state.status !== "connected" || demoDone) return;
    demoDone = true;
    const z = 2, before = state.zones[z - 1].input, to = before === 7 ? 3 : 7;
    const restored = guarded.includes(z);
    zone(z, { input: to });
    set({ changes: [...(state.changes ?? []), { id: nextId++, at: Date.now(), zone: z, what: "input" as const, from: before, to, restored }].slice(-12) });
    if (restored) setTimeout(() => zone(z, { input: before }), 400);
  };
  const demoNames = ["Hall", "Stage", "Playground", "Corridor", "Canteen", "Office", "Gym", "Outside",
    "Mic", "Streambox", "CD - USB", "Aux", "Line 5", "Line 6", ...Array.from({ length: 16 }, (_, i) => (i % 2 ? "Wall mic" : "Wall input"))];
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
          setTimeout(() => set({ status: "connected", known: true, names: demoNames, namesAnswered: 30 }), 400);
          setTimeout(someoneElse, 9000);
          return;
        case "audac_set_guard": guarded = ((a.rules as GuardRule[]) ?? []).filter((r) => r.full).map((r) => r.zone); return;
        case "audac_talk": return { lines: ["(demo: no real MTX)"], others: [{ name: "web", agoMs: 400, lines: 12 }], vuLines: 0 };
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
