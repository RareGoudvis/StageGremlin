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
import { audac, audacConnectSaved } from "./audac";
import { bg } from "../components/background/useBackground";
import { connectText, spotifyToBox, streambox } from "./streambox";
import { setProblem, slog } from "./scheduleLog";
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
  const level = e.music.boxVolume ?? BOX_VOLUME;
  try {
    await streambox.setMute(false);
    await streambox.setVolume(level);
    slog(e.name, { key: "s.log.boxUp", vars: { level } }, "ok", false);
  } catch (err) {
    slog(e.name, { key: "s.log.boxUpFailed", vars: { err: String(err) } }, "bad");
  }
}

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

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
    if (!warned.has(e.id)) slog(e.name, { key: "s.log.noMtx" }, "bad");
    warned.add(e.id);
    return;
  }
  warned.delete(e.id);
  started.set(e.id, e);
  publish();
  setProblem(e.id, null);
  slog(e.name, { key: "s.log.started" }, "info", true);
  for (const z of e.zones) {
    await audac.setInput(z, e.input);
    await audac.setVolume(z, volumeFor(e, z));
    await audac.setMute(z, false);
  }
  slog(e.name, { key: "s.log.zonesOn", vars: { zones: e.zones.join(", "), input: e.input } }, "ok", false);
  if (usesBox(e)) await boxUp(e);
  if (e.music.source) void music(e);
}

/** Still the same run? (It may have ended, or the app restarted it.) */
const running = (e: ScheduleEntry) => started.get(e.id) === e;

/**
 * The music for a scheduled time. Spotify on the box: MOVE FIRST, THEN PLAY, so the laptop never
 * plays (Spotify plays where it was last set to, and that's this laptop). The Spotify window's own
 * volume stays at silent meanwhile, as a safety net. Every step goes into the log.
 */
async function music(e: ScheduleEntry) {
  const src = e.music.source;
  if (!src) return;
  const onBox = src === "spotify" && !!e.music.onBox;
  try {
    if (onBox) await bg.setFader("spotify", -60).catch(() => {});
    await bg.open(src, false, e.music.link || undefined);
    slog(e.name, { key: e.music.link ? "s.log.openingLink" : "s.log.opening", vars: { src } }, "info", false);
  } catch (err) {
    slog(e.name, { key: "s.log.musicFailed", vars: { err: String(err) } }, "bad");
    setProblem(e.id, { key: "s.prob.musicFailed", vars: { err: String(err) } });
    return;
  }
  await sleep(PAGE_LOAD_MS);
  if (!running(e)) return;
  const p = (await bg.getState().catch(() => null))?.players?.find((x) => x.source === src);
  if (p?.signedIn === false) {
    slog(e.name, { key: "s.log.notSignedIn", vars: { src } }, "bad");
    setProblem(e.id, { key: "s.prob.notSignedIn", vars: { src } });
    return;
  }

  if (onBox) {
    const moved = await toBox(e);
    if (!running(e)) return;
    if (moved) {
      await invokeBg("bg_start_list", { source: "spotify" });
      slog(e.name, { key: "s.log.listOnBox" }, "info", false);
    } else if (e.music.boxFallback === "laptop") {
      await bg.setFader("spotify", 0).catch(() => {});
      await bg.command("play").catch(() => {});
      slog(e.name, { key: "s.log.fbLaptop" }, "bad");
      setProblem(e.id, { key: "s.prob.fbLaptop" });
    } else {
      await bg.command("pause", true).catch(() => {});
      await bg.setFader("spotify", 0).catch(() => {});
      slog(e.name, { key: "s.log.fbSilent" }, "bad");
      setProblem(e.id, { key: "s.prob.fbSilent" });
      return;
    }
  } else {
    await bg.command("play").catch(() => {});
    slog(e.name, { key: "s.log.musicStarted" }, "info", false);
  }

  // Shuffle / repeat (Spotify): once it plays.
  if (src === "spotify" && (e.music.shuffle !== undefined || e.music.repeat)) {
    await sleep(1_500);
    await invokeBg("bg_shuffle_repeat", { shuffle: e.music.shuffle ?? null, repeat: e.music.repeat ?? null });
  }

  // Check: does Spotify say it plays on the box?
  if (onBox) {
    await sleep(6_000);
    if (!running(e)) return;
    const q = (await bg.getState().catch(() => null))?.players?.find((x) => x.source === "spotify");
    if (q?.remote) slog(e.name, { key: "s.log.onBoxSays", vars: { device: q.remote } }, "ok", true);
    else if (q?.playing) {
      slog(e.name, { key: "s.log.onLaptop" }, "bad");
      if (await toBox(e)) slog(e.name, { key: "s.log.movedSecond" }, "ok", true);
      else setProblem(e.id, { key: "s.prob.stayedLaptop" });
    } else slog(e.name, { key: "s.log.whereUnknown" }, "info", true);
  }
}

/** Move Spotify to the box: try until Spotify's device list says it worked (the page may still be
 *  settling). Logs each try; a failure names what Spotify does list. */
async function toBox(e: ScheduleEntry): Promise<boolean> {
  for (let attempt = 1; attempt <= 5 && running(e); attempt++) {
    const r = await spotifyToBox(true).catch(() => null);
    const ok = r?.state === "ok";
    slog(e.name, { key: "s.log.moveTry", vars: { n: attempt, result: connectText(r, true) } }, ok ? "ok" : "info", false);
    if (ok) return true;
    await sleep(5_000);
  }
  return false;
}

async function end(e: ScheduleEntry, after: "release" | "keep") {
  started.delete(e.id);
  publish();
  if (e.music.source) {
    await bg.command("pause", true).catch(() => {});
    // The Spotify window was kept silent while it played on the box: give it its volume back.
    if (e.music.source === "spotify" && e.music.onBox) window.setTimeout(() => void bg.setFader("spotify", 0).catch(() => {}), 1_500);
  }
  const st = await audac.getState();
  if (st.status === "connected") {
    for (const z of e.zones) await audac.setMute(z, true);
  }
  // Let go only when no other scheduled time is still on.
  if (after === "release" && started.size === 0) {
    // Give the mute commands a moment to leave before the link closes.
    window.setTimeout(() => void audac.disconnect(), 1500);
  }
  slog(e.name, { key: "s.log.ended" }, "info", true);
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
