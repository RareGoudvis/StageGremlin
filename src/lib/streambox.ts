// Remote control for the streambox (Settings › Streambox): volume, mute, and with DLNA also play / pause /
// stop. Two ways to talk to it, DLNA or Google Cast; the school keeps whichever its box answers to.
// The core does the talking (src-tauri/src/streambox); this polls its status every few seconds while a
// panel shows it. A browser gets a small simulator.

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./tauri";
import { useSettings, type StreamboxSetup } from "../settingsStore";

export interface BoxStatus {
  volume: number;
  muted: boolean;
  playing: boolean | null;
  title: string | null;
  app: string | null;
  canTransport: boolean;
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
  sendStart: () => cmd<string>("streambox_send_start", { target: target(useSettings.getState().ui.streambox), format: useSettings.getState().ui.streambox.format }),
  sendStop: () => cmd<void>("streambox_send_stop", {}),
  sending: () => cmd<boolean>("streambox_sending", {}),
};

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
  if (name === "streambox_sending") return simSending;
  if (name === "streambox_set_volume") simState.volume = Number(a.volume);
  if (name === "streambox_set_mute") simState.muted = !!a.mute;
  if (name === "streambox_transport") simState.playing = a.action === "play";
  return { ...simState };
}
