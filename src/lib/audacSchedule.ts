// The AUDAC schedule (Settings › Schedule): at a set time on set days, StageGremlin connects to the MTX,
// switches zones to an input at a level, unmutes them and can start a background playlist. At the end
// time it pauses the music, mutes those zones and (by choice) lets the MTX go.
//
// It runs only while StageGremlin is open: a check every 10 seconds, from App. Starting is safe to
// repeat, so if the app is opened in the middle of lunch, lunch simply starts then.

import { useEffect } from "react";
import { create } from "zustand";
import { volumeFor } from "./audacGroups";
import { useSettings, type ScheduleEntry } from "../settingsStore";
import { useDoc } from "../store";
import { toast } from "../uiStore";
import { audac, audacConnectSaved } from "./audac";
import { bg } from "../components/background/useBackground";
import { connectText, spotifyToBox, streambox } from "./streambox";
import { isTauri } from "./tauri";

/** A background-player command that only exists in the app (not in a plain browser). */
async function invokeBg(name: string, args: Record<string, unknown>) {
  if (!isTauri) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke(name, args).catch(() => {});
}

/** The Streambox's own volume during a scheduled time, unless the time says otherwise. */
export const BOX_VOLUME = 80;

/** Does this time play through the Streambox? Spotify moved to it, or zones on the box's MTX input. */
export function usesBox(e: ScheduleEntry): boolean {
  const box = useSettings.getState().ui.streambox;
  if (!box.ip) return false;
  return (e.music.source === "spotify" && !!e.music.onBox) || (box.audacInput > 0 && e.input === box.audacInput);
}

/** Unmute the Streambox and set its volume: zones on its input hear nothing while it is at 0 or muted. */
async function boxUp(e: ScheduleEntry) {
  try {
    await streambox.setMute(false);
    await streambox.setVolume(e.music.boxVolume ?? BOX_VOLUME);
  } catch (err) {
    toast(`Schedule “${e.name}”: couldn't turn the Streambox up (${err})`);
  }
}

const CHECK_EVERY_MS = 10_000;
/** Give the playlist page this long to load before pressing play. */
const PAGE_LOAD_MS = 8_000;

/** Times we started in this session, kept as they were then (so the end mutes the same zones). */
const started = new Map<string, ScheduleEntry>();

/** The scheduled times running now (their zones are protected: lib/audacGroups.ts, guardRules). */
export const useScheduleRunning = create<{ running: ScheduleEntry[] }>(() => ({ running: [] }));
const publish = () => useScheduleRunning.setState({ running: [...started.values()] });
/** Times we already warned about (can't reach the MTX), so the toast doesn't repeat every check. */
const warned = new Set<string>();
let checking = false;

export function useAudacSchedule() {
  useEffect(() => {
    const timer = window.setInterval(() => void check(), CHECK_EVERY_MS);
    void check();
    return () => window.clearInterval(timer);
  }, []);
}

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** Is `e` on right now? */
export function isActive(e: ScheduleEntry, now: Date): boolean {
  const m = now.getHours() * 60 + now.getMinutes();
  return e.on && e.days.includes(now.getDay()) && m >= minutesOf(e.from) && m < minutesOf(e.to);
}

/** The next moment `e` starts (within a week), or null when it never will. */
export function nextStart(e: ScheduleEntry, now: Date): Date | null {
  if (!e.on || !e.days.length || minutesOf(e.to) <= minutesOf(e.from)) return null;
  for (let d = 0; d < 8; d++) {
    const day = new Date(now);
    day.setDate(now.getDate() + d);
    day.setHours(0, minutesOf(e.from), 0, 0);
    if (e.days.includes(day.getDay()) && day > now) return day;
  }
  return null;
}

async function check() {
  if (checking) return; // a slow start (waiting for the MTX) must not overlap the next check
  checking = true;
  try {
    const setup = useSettings.getState().ui.audac;
    if (!setup.host.trim() && !setup.demo) return; // no MTX set up (the demo counts as one)
    const now = new Date();
    const inShow = useDoc.getState().mode === "run";

    for (const [id, was] of [...started]) {
      const e = setup.schedule.find((x) => x.id === id);
      if (!e || !isActive(e, now)) await end(was, setup.scheduleAfter);
    }
    for (const e of setup.schedule) {
      if (!isActive(e, now)) {
        warned.delete(e.id);
        continue;
      }
      // During a show the schedule waits; it starts after the show if the time is still on.
      if (!started.has(e.id) && !(inShow && setup.schedulePauseInRun)) await start(e);
    }
  } finally {
    checking = false;
  }
}

async function start(e: ScheduleEntry) {
  if (!(await connected())) {
    if (!warned.has(e.id)) toast(`Schedule “${e.name}”: can't reach the MTX. Trying again…`);
    warned.add(e.id);
    return;
  }
  started.set(e.id, e);
  publish();
  for (const z of e.zones) {
    await audac.setInput(z, e.input);
    await audac.setVolume(z, volumeFor(e, z));
    await audac.setMute(z, false);
  }
  if (usesBox(e)) await boxUp(e);
  if (e.music.source) {
    try {
      await bg.open(e.music.source, false, e.music.link || undefined);
      window.setTimeout(() => void bg.command("play").catch(() => {}), PAGE_LOAD_MS);
      // Shuffle / repeat (Spotify): right after play starts, before any move to the box.
      if (e.music.source === "spotify" && (e.music.shuffle !== undefined || e.music.repeat)) {
        window.setTimeout(() => void invokeBg("bg_shuffle_repeat", { shuffle: e.music.shuffle ?? null, repeat: e.music.repeat ?? null }), PAGE_LOAD_MS + 1_500);
      }
      // Not signed in: say so (the music won't play), with what to do.
      window.setTimeout(() => {
        void bg.getState().then((st) => {
          const p = st.players?.find((x) => x.source === e.music.source);
          if (p?.signedIn === false) toast(`Schedule “${e.name}”: ${e.music.source} isn't signed in on this laptop, so no music. Open Background, pick it and sign in once.`);
        }).catch(() => {});
      }, PAGE_LOAD_MS + 4_000);
      // Spotify on the Streambox: a freshly loaded player claims the music for itself, so move it to
      // the box after it starts (see toBox).
      if (e.music.source === "spotify" && e.music.onBox) {
        window.setTimeout(() => void toBox(e), PAGE_LOAD_MS + 3_000);
      }
    } catch (err) {
      toast(`Schedule “${e.name}”: background music didn't start (${err})`);
    }
  }
  toast(`Schedule: “${e.name}” started`);
}

/** Move Spotify to the box: try until Spotify's device list says it worked (a few times, the page may
 *  still be settling), then once more a little later, because a freshly loaded player sometimes takes
 *  the music back. Says how it went; a failure names what Spotify does list. */
async function toBox(e: ScheduleEntry) {
  let last = null;
  for (let attempt = 0; attempt < 5 && started.has(e.id); attempt++) {
    last = await spotifyToBox(true).catch(() => null);
    if (last?.state === "ok") break;
    await new Promise((r) => window.setTimeout(r, 5_000));
  }
  if (!started.has(e.id)) return;
  toast(`Schedule “${e.name}”: ${connectText(last, true)}`);
  if (last?.state === "ok") window.setTimeout(() => void (started.has(e.id) && spotifyToBox(true).catch(() => null)), 12_000);
}

async function end(e: ScheduleEntry, after: "release" | "keep") {
  started.delete(e.id);
  publish();
  if (e.music.source) await bg.command("pause").catch(() => {});
  const st = await audac.getState();
  if (st.status === "connected") {
    for (const z of e.zones) await audac.setMute(z, true);
  }
  // Let go only when no other scheduled time is still on.
  if (after === "release" && started.size === 0) {
    // Give the mute commands a moment to leave before the link closes.
    window.setTimeout(() => void audac.disconnect(), 1500);
  }
  toast(`Schedule: “${e.name}” ended`);
}

/** Connect if needed and wait (up to 20 s) until the MTX has reported its zones. */
async function connected(): Promise<boolean> {
  const ready = (s: Awaited<ReturnType<typeof audac.getState>>) => s.status === "connected" && s.known;
  if (ready(await audac.getState())) return true;
  audacConnectSaved();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (ready(await audac.getState())) return true;
  }
  return false;
}
