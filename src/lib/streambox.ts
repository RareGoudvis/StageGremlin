// Remote control for the streambox (Settings › Streambox): volume, mute, and with DLNA also play / pause /
// stop. Two ways to talk to it, DLNA or Google Cast; the school keeps whichever its box answers to.
// The core does the talking (src-tauri/src/streambox); this polls its status every few seconds while a
// panel shows it. A browser gets a small simulator.

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./tauri";
import { useSettings, type StreamboxSetup } from "../settingsStore";
import { translate, type TKey } from "../i18n";
import { bg, type BgState } from "../components/background/useBackground";

export interface BoxStatus {
  volume: number;
  muted: boolean;
  playing: boolean | null;
  title: string | null;
  app: string | null;
  canTransport: boolean;
}

export interface SendReport {
  on: boolean;
  url: string | null;
  /** 0 = nobody is pulling the stream. */
  listeners: number;
}

const POLL_MS = 3000;

const target = (b: StreamboxSetup) => ({ via: b.via, ip: b.ip, dlnaUrl: b.dlnaUrl || null });

async function cmd<T>(name: string, args: Record<string, unknown>): Promise<T> {
  if (isTauri) return invoke<T>(name, args);
  return sim(name, args) as T;
}

export const streambox = {
  status: () => cmd<BoxStatus>("streambox_status", { target: target(useSettings.getState().ui.streambox) }),
  setVolume: (volume: number) => cmd<void>("streambox_set_volume", { target: target(useSettings.getState().ui.streambox), volume: Math.round(volume) }),
  setMute: (mute: boolean) => cmd<void>("streambox_set_mute", { target: target(useSettings.getState().ui.streambox), mute }),
  transport: (action: "play" | "pause" | "stop") => cmd<void>("streambox_transport", { target: target(useSettings.getState().ui.streambox), action }),
  /** Send StageGremlin's show output to the box; returns the stream address the box got. */
  sendStart: () => cmd<string>("streambox_send_start", {
    target: target(useSettings.getState().ui.streambox),
    format: useSettings.getState().ui.streambox.format,
    source: useSettings.getState().ui.streambox.source ?? "background",
  }),
  sendStop: () => cmd<void>("streambox_send_stop", {}),
  /** Sending now? (`report` also says to what address and how many are listening.) */
  sending: () => cmd<SendReport>("streambox_sending", {}).then((r) => r.on),
  report: () => cmd<SendReport>("streambox_sending", {}),
};

/** The first name tried in Spotify's device list (see connectNames). */
export function connectName(): string {
  return connectNames()[0];
}

/** Names the box may have in Spotify's device list, best first: the name set in Settings, the
 *  box's own name (as it answered when found), then the usual Pro-Ject names. Spaces, underscores
 *  and capitals don't count when matching (inject.js, connect). */
export function connectNames(): string[] {
  const box = useSettings.getState().ui.streambox;
  const looksLikeId = (n: string) => /^[0-9a-f-]{16,}$/i.test(n) || /^\d+\.\d+\.\d+\.\d+$/.test(n);
  const list = [box.connectName ?? "", box.name && !looksLikeId(box.name) ? box.name : "", "Stream Box", "Streambox", "Pro-Ject"];
  const out: string[] = [];
  for (const n of list.map((x) => x.trim())) if (n && !out.some((o) => o.toLowerCase() === n.toLowerCase())) out.push(n);
  return out;
}

/** How the last move through Spotify's device list went (inject.js, connect). */
export interface ConnectResult {
  state: "ok" | "no-button" | "no-device";
  device: string | null;
  devices: string[];
  at: number;
}

const spotifyConnect = (st: BgState): ConnectResult | null => st.players?.find((p) => p.source === "spotify")?.connect ?? null;

/** Spotify Connect: play Spotify on the box (true) or back in the background player (false).
 *  Waits for Spotify's page to say how it went (null = the page didn't answer in time). */
export async function spotifyToBox(on: boolean): Promise<ConnectResult | null> {
  if (!isTauri) return { state: "ok", device: on ? "Stream Box" : "This web browser", devices: [], at: Date.now() };
  const before = spotifyConnect(await bg.getState().catch(() => ({}) as BgState))?.at ?? 0;
  await invoke("bg_spotify_connect", { names: on ? connectNames() : [] });
  // The page tries for up to 3 s (longer when the window is hidden: timers slow down), then reports.
  for (let i = 0; i < 24; i++) {
    await new Promise((r) => window.setTimeout(r, 500));
    const r = spotifyConnect(await bg.getState().catch(() => ({}) as BgState));
    if (r && r.at !== before) return r;
  }
  return null;
}

/** The outcome in words, for a toast. */
export function connectText(r: ConnectResult | null, on: boolean): string {
  const tr = (k: TKey) => translate(useSettings.getState().ui.lang, k);
  if (!r) return tr("sbx.connectNoAnswer");
  if (r.state === "ok") return `${tr(on ? "sbx.connectOkBox" : "sbx.connectBack")}${on && r.device ? ` (${r.device})` : ""}`;
  if (r.state === "no-button") return tr("sbx.connectNoButton");
  if (r.devices.length === 0) return tr("sbx.connectEmpty");
  return `${tr("sbx.connectNotListed")} ${r.devices.join(" · ")}. ${tr("sbx.connectFixName")}`;
}

/** Live status while mounted (null = not asked yet). `error` says why the box doesn't answer. */
export function useStreambox(): { status: BoxStatus | null; error: string | null; refresh: () => void } {
  const box = useSettings((s) => s.ui.streambox);
  const [status, setStatus] = useState<BoxStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!box.ip) return;
    let alive = true;
    const ask = () =>
      streambox.status().then(
        (s) => alive && (setStatus(s), setError(null)),
        (e) => alive && setError(String(e)),
      );
    void ask();
    const timer = window.setInterval(ask, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [box.ip, box.via, box.dlnaUrl, tick]);
  return { status, error, refresh: () => setTick((n) => n + 1) };
}

// ---- browser simulator ----
const simState: BoxStatus = { volume: 35, muted: false, playing: true, title: "Golden Hour", app: "JVKE", canTransport: true };
let simSending = false;
function sim(name: string, a: Record<string, unknown>): unknown {
  if (name === "streambox_send_start") { simSending = true; return "http://192.168.1.10:51234/stream.wav"; }
  if (name === "streambox_send_stop") { simSending = false; return; }
  if (name === "streambox_sending") return { on: simSending, url: simSending ? "http://192.168.1.10:51234/stream.wav" : null, listeners: simSending ? 1 : 0 };
  if (name === "streambox_set_volume") simState.volume = Number(a.volume);
  if (name === "streambox_set_mute") simState.muted = !!a.mute;
  if (name === "streambox_transport") simState.playing = a.action === "play";
  return { ...simState };
}
