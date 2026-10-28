// "What happened": every step of a scheduled time, with the time and how it went (Settings › Schedule).
// A schedule usually runs with nobody watching, and a toast is gone after a few seconds; this stays,
// also after a restart (kept in this laptop's browser storage, best effort, the last 100 lines).

import { create } from "zustand";
import { toast } from "../uiStore";

export type LogLevel = "ok" | "info" | "bad";

export interface LogLine {
  /** ms since 1970 */
  at: number;
  /** The scheduled time's name. */
  entry: string;
  text: string;
  level: LogLevel;
}

const KEY = "sg.scheduleLog";
const KEEP = 100;

function load(): LogLine[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as LogLine[]) : [];
    return Array.isArray(list) ? list.slice(-KEEP) : [];
  } catch {
    return [];
  }
}

interface LogStore {
  lines: LogLine[];
  /** Scheduled time id → what went wrong the last time it ran (cleared when it runs fine). */
  problems: Record<string, string>;
}

export const useScheduleLog = create<LogStore>(() => ({ lines: load(), problems: {} }));

function save(lines: LogLine[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(lines));
  } catch {
    /* not kept: fine */
  }
}

/** Add a line. `alsoToast`: show it as a toast too (problems and the final result). */
export function slog(entry: string, text: string, level: LogLevel = "info", alsoToast = level === "bad") {
  const lines = [...useScheduleLog.getState().lines, { at: Date.now(), entry, text, level }].slice(-KEEP);
  useScheduleLog.setState({ lines });
  save(lines);
  if (alsoToast) toast(`Schedule “${entry}”: ${text}`);
}

export function setProblem(id: string, text: string | null) {
  const problems = { ...useScheduleLog.getState().problems };
  if (text) problems[id] = text;
  else delete problems[id];
  useScheduleLog.setState({ problems });
}

export function clearScheduleLog() {
  useScheduleLog.setState({ lines: [] });
  save([]);
}
