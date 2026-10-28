// "What happened": every step of a scheduled time, with the time and how it went (Settings › Schedule).
// A schedule usually runs with nobody watching, and a toast is gone after a few seconds; this stays,
// also after a restart (kept in this laptop's browser storage, best effort, the last 100 lines).

import { create } from "zustand";
import { toast } from "../uiStore";
import { tr, type TKey, type TVars } from "../i18n";

export type LogLevel = "ok" | "info" | "bad";

/** A message as a translation key (src/lang/settings.ts) plus its placeholders, so the log can be
 *  shown in whatever language is chosen later. */
export interface LogMsg {
  key: TKey;
  vars?: TVars;
}

export interface LogLine {
  /** ms since 1970 */
  at: number;
  /** The scheduled time's name. */
  entry: string;
  /** The text as it was when logged (older lines only have this). */
  text: string;
  level: LogLevel;
  /** The same message as a key, translated again when shown. */
  key?: TKey;
  vars?: TVars;
}

/** A line's text in the current language. */
export function lineText(l: LogLine): string {
  return l.key ? tr(l.key, l.vars) : l.text;
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
  problems: Record<string, LogMsg>;
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
export function slog(entry: string, msg: LogMsg, level: LogLevel = "info", alsoToast = level === "bad") {
  const text = tr(msg.key, msg.vars);
  const lines = [...useScheduleLog.getState().lines, { at: Date.now(), entry, text, level, key: msg.key, vars: msg.vars }].slice(-KEEP);
  useScheduleLog.setState({ lines });
  save(lines);
  if (alsoToast) toast(tr("s.log.toast", { entry, text }));
}

export function setProblem(id: string, msg: LogMsg | null) {
  const problems = { ...useScheduleLog.getState().problems };
  if (msg) problems[id] = msg;
  else delete problems[id];
  useScheduleLog.setState({ problems });
}

export function clearScheduleLog() {
  useScheduleLog.setState({ lines: [] });
  save([]);
}
