// The AUDAC schedule (Settings › Schedule): at a set time on set days, StageGremlin connects to the MTX,
// switches zones to an input at a level, unmutes them and can start a background playlist. At the end
// time it pauses the music, mutes those zones and (by choice) lets the MTX go.
//
// It runs only while StageGremlin is open: a check every 10 seconds, from App. Starting is safe to
// repeat, so if the app is opened in the middle of lunch, lunch simply starts then.

import { useEffect } from "react";
import { useSettings, type ScheduleEntry } from "../settingsStore";
import { useDoc } from "../store";
import { toast } from "../uiStore";
import { audac, audacConnectSaved } from "./audac";
import { bg } from "../components/background/useBackground";

const CHECK_EVERY_MS = 10_000;
/** Give the playlist page this long to load before pressing play. */
const PAGE_LOAD_MS = 8_000;

/** Times we started in this session, kept as they were then (so the end mutes the same zones). */
const started = new Map<string, ScheduleEntry>();
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
  for (const z of e.zones) {
    await audac.setInput(z, e.input);
    await audac.setVolume(z, e.volume);
    await audac.setMute(z, false);
  }
  if (e.music.source) {
    try {
      await bg.open(e.music.source, false, e.music.link || undefined);
      window.setTimeout(() => void bg.command("play").catch(() => {}), PAGE_LOAD_MS);
    } catch (err) {
      toast(`Schedule “${e.name}”: background music didn't start (${err})`);
    }
  }
  toast(`Schedule: “${e.name}” started`);
}

async function end(e: ScheduleEntry, after: "release" | "keep") {
  started.delete(e.id);
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
