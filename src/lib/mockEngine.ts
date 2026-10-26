// Browser-only stand-in for the Rust side, used when the UI runs outside Tauri
// (plain `npm run dev`). It is NOT the real playback logic: it only fakes enough
// state (playhead, running cues, meters, log, preview, YouTube) to design and test the screens.
// Inside Tauri this file is never used.

import type { Analysis, Cue, EngineState, LogEntry, RunningInfo, Show } from "../types";
import { goQueue, passLen } from "../types";
import type { YtItem } from "../types";
import { fileFor } from "./browserFiles";

type Listener = (p: unknown) => void;
const listeners = new Map<string, Set<Listener>>();
const emit = (event: string, payload: unknown) => listeners.get(event)?.forEach((cb) => cb(payload));

interface SimRun { instance: number; cue: Cue; startedAt: number; under: boolean; vamping: boolean; padId: string | null }

const sim = {
  show: null as Show | null,
  playhead: null as string | null,
  running: [] as SimRun[],
  newLog: [] as LogEntry[],
  t0: performance.now(),
  nextInstance: 1,
  timer: 0 as number | ReturnType<typeof setInterval>,
  preview: null as { cue: Cue; startedAt: number; at: number } | null,
  previewTimer: 0 as number | ReturnType<typeof setInterval>,
  ytDlp: null as string | null,
  ffmpeg: false,
};

const clock = () => (performance.now() - sim.t0) / 1000;

function log(kind: string, cue: Cue | null, text: string) {
  sim.newLog.push({ clock: clock(), wallMs: Date.now(), kind, cueId: cue?.id ?? null, text });
}

function lenOf(c: Cue) {
  return passLen(c) || 120; // unanalysed demo cues pretend to be 2 minutes long
}

function fire(c: Cue, at = 0, padId: string | null = null) {
  sim.running.push({ instance: sim.nextInstance++, cue: c, startedAt: clock() - at, under: false, vamping: !!c.vamp?.on && at === 0, padId });
  log(padId ? "pad" : "go", c, padId ? `Pad ${c.name}` : `${c.number} ${c.name}`);
}

function emitState() {
  const now = clock();
  // Drop finished cues (loops run until stopped).
  sim.running = sim.running.filter((r) => {
    const total = lenOf(r.cue) * Math.max(1, r.cue.playCount);
    return r.cue.playCount === 0 || now - r.startedAt < total;
  });
  const running: RunningInfo[] = sim.running.map((r) => {
    const len = lenOf(r.cue);
    const el = now - r.startedAt;
    const pass = Math.floor(el / len) + 1;
    const position = el % len;
    const marker = r.cue.markers.filter((m) => m.t > position).sort((a, b) => a.t - b.t)[0];
    return {
      instance: r.instance, cueId: r.cue.id, number: r.cue.number, name: r.cue.name,
      position, length: len, remaining: len - position, pass, playCount: r.cue.playCount,
      under: r.under, vamping: r.vamping, stopping: false, attached: !!r.cue.attach,
      padId: r.padId, duckBg: r.cue.duckBg,
      nextMarker: marker ? [marker.label, marker.t - position] : null,
    };
  });
  // Fake but lively meters: louder while something plays.
  const level = running.length ? (running.some((r) => r.under) ? 0.25 : 0.7) : 0;
  const wobble = () => level * (0.75 + Math.random() * 0.3);
  const state: EngineState = {
    clock: now,
    playhead: sim.playhead,
    running,
    pending: [],
    meter: { peakL: wobble(), peakR: wobble(), grDb: level > 0.6 && Math.random() > 0.8 ? 1.2 : 0, overs: 0 },
    newLog: sim.newLog,
  };
  sim.newLog = [];
  emit("engine://state", state);
}

function ensureTimer() {
  if (!sim.timer) sim.timer = setInterval(emitState, 1000 / 30);
}

function previewTick() {
  const p = sim.preview;
  if (!p) return;
  const len = lenOf(p.cue);
  const position = p.at + (performance.now() - p.startedAt) / 1000;
  const playing = position < len;
  emit("preview://state", { playing, name: p.cue.name, position: Math.min(position, len), length: len, outputName: "Headphones (Realtek(R) Audio)" });
  if (!playing) stopPreview();
}

function stopPreview() {
  clearInterval(sim.previewTimer);
  sim.previewTimer = 0;
  sim.preview = null;
  emit("preview://state", { playing: false, name: null, position: 0, length: 0, outputName: "Headphones (Realtek(R) Audio)" });
}

/** Fake download progress for each item, 0 → 100 % over a few seconds. */
function fakeDownloads(items: { id: string; title: string }[], format: string) {
  items.forEach((it, i) => {
    let pct = 0;
    emit("yt://progress", { id: it.id, percent: 0, status: "queued", file: null, error: null });
    setTimeout(() => {
      const t = setInterval(() => {
        pct += 9 + Math.random() * 12;
        if (pct >= 100) {
          clearInterval(t);
          const ext = format === "original" ? "m4a" : format;
          emit("yt://progress", { id: it.id, percent: 100, status: "done", file: `C:/Schoolfeest/media/${it.title}.${ext}`, error: null });
        } else {
          emit("yt://progress", { id: it.id, percent: pct, status: pct > 85 && format !== "original" ? "converting" : "downloading", file: null, error: null });
        }
      }, 250);
    }, i * 600);
  });
}

function fakeInstall(what: string) {
  let pct = 0;
  const t = setInterval(() => {
    pct += 15;
    const done = pct >= 100;
    if (done) {
      clearInterval(t);
      if (what === "ytDlp") sim.ytDlp = "2026.10.01";
      else sim.ffmpeg = true;
    }
    emit("yt://install", { what, percent: Math.min(100, pct), done });
  }, 200);
}

function fakeResolve(lines: string[]): YtItem[] {
  const out: YtItem[] = [];
  lines.forEach((line, n) => {
    const isList = /list=/.test(line);
    const count = isList ? 3 : 1;
    for (let i = 0; i < count; i++) {
      const title = isList ? `Playlist track ${i + 1}` : line.startsWith("http") ? `Video ${n + 1}` : line.replace(/\s+[-–]\s+/, " – ");
      out.push({
        id: `yt${n}-${i}-${Math.random().toString(36).slice(2, 7)}`, input: line, url: line.startsWith("http") ? line : `https://youtu.be/demo${n}`,
        title, channel: isList ? "Schoolfeest mix" : "Some Channel", duration: 150 + ((n * 37 + i * 53) % 120),
        playlist: isList ? "Schoolfeest dansen" : null, error: line.includes("bad") ? "Video unavailable" : null,
      });
    }
  });
  return out;
}

export async function mockInvoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  if (cmd !== "engine_set_show") console.info("[cueplay mock] invoke", cmd, args ?? "");
  const queue = sim.show ? goQueue(sim.show) : [];
  switch (cmd) {
    case "engine_set_show": {
      sim.show = args?.show as Show;
      const q = goQueue(sim.show);
      if (!sim.playhead || !q.some((c) => c.id === sim.playhead)) sim.playhead = q[0]?.id ?? null;
      return;
    }
    case "engine_go": {
      const i = queue.findIndex((c) => c.id === sim.playhead);
      if (i < 0) return "endOfShow";
      fire(queue[i]);
      sim.playhead = queue[i + 1]?.id ?? null;
      return "fired";
    }
    case "engine_go_from": {
      const i = queue.findIndex((c) => c.id === args?.cueId);
      if (i < 0) return;
      fire(queue[i], Math.max(0, Number(args?.at ?? 0) - queue[i].trimIn));
      sim.playhead = queue[i + 1]?.id ?? null;
      return;
    }
    case "engine_pad": {
      const pad = sim.show?.pads.find((p) => p.id === args?.padId);
      if (!pad) return;
      const running = sim.running.find((r) => r.padId === pad.id);
      if (running && pad.mode !== "oneShot") sim.running = sim.running.filter((r) => r !== running);
      else fire({ ...pad.cue, playCount: pad.mode === "loop" ? 0 : 1 }, 0, pad.id);
      return;
    }
    case "engine_resume":
      for (const it of (args?.items as { cueId: string; position: number }[]) ?? []) {
        const c = queue.find((x) => x.id === it.cueId);
        if (c) fire(c, it.position);
      }
      return;
    case "engine_stop_all":
      sim.running = [];
      log("stopAll", null, "Stop all");
      return;
    case "engine_panic":
      sim.running = [];
      log("panic", null, "Panic");
      return;
    case "engine_stop_cue": {
      const r = sim.running.find((x) => x.cue.id === args?.cueId);
      sim.running = sim.running.filter((x) => x.cue.id !== args?.cueId);
      if (r) log("stop", r.cue, `${r.cue.number} ${r.cue.name}`);
      return;
    }
    case "engine_toggle_under":
    case "engine_release_vamp": {
      const id = args?.cueId as string | null;
      const r = id ? sim.running.find((x) => x.cue.id === id) : sim.running[sim.running.length - 1];
      if (r && cmd === "engine_toggle_under") r.under = !r.under;
      if (r && cmd === "engine_release_vamp") r.vamping = false;
      return;
    }
    case "engine_set_playhead":
      sim.playhead = (args?.cueId as string | null) ?? null;
      return;
    case "preview_play":
      stopPreview();
      sim.preview = { cue: args?.cue as Cue, startedAt: performance.now(), at: Number(args?.at ?? 0) };
      sim.previewTimer = setInterval(previewTick, 100);
      return;
    case "preview_stop":
      stopPreview();
      return;
    case "analyze_file":
      return fakeAnalysis(String(args?.file ?? ""));
    case "app_info":
      return { version: "dev", portable: false, dataDir: "C:/CuePlay/data" };
    case "audio_list_outputs":
      return [
        { name: "Speakers (Realtek(R) Audio)", isDefault: true },
        { name: "Headphones (Realtek(R) Audio)", isDefault: false },
        { name: "Qu-24 USB", isDefault: false },
      ];
    case "audio_output_status":
      return { outputName: "Browser · Windows default output", outputFound: true, preferred: null };
    case "audio_set_output": {
      const name = (args?.name as string | null) ?? null;
      emit("engine://output", { outputName: name ?? "Speakers (Realtek(R) Audio)", outputFound: true, preferred: name });
      return;
    }
    case "app_resume_info":
      // Add ?resume to the URL to see the crash-resume dialog in the browser.
      return location.search.includes("resume")
        ? { showPath: "C:/Schoolfeest/Schoolfeest 2027.cueplay", playhead: null, running: [{ cueId: "x", name: "Dans 3B — Medley", position: 83 }], savedAtMs: Date.now() - 40_000 }
        : null;
    case "yt_status":
      return { ytDlp: sim.ytDlp, ffmpeg: sim.ffmpeg, binDir: "C:/CuePlay/data/bin" };
    case "yt_install":
      fakeInstall(String(args?.what));
      return;
    case "yt_resolve":
      await new Promise((r) => setTimeout(r, 500));
      return fakeResolve((args?.lines as string[]) ?? []);
    case "yt_download":
      fakeDownloads(args?.items as { id: string; title: string }[], String(args?.format));
      return;
    case "media_convert":
      if (!sim.ffmpeg) throw new Error("ffmpeg is not installed");
      await new Promise((r) => setTimeout(r, 800));
      return String(args?.path).replace(/\.(opus|webm)$/i, ".m4a");
    case "engine_pause_all":
      // The simulator has no audio; the browser build pauses in webAudioEngine.ts.
      return false;
    case "file_exists":
      // Browser: picked files exist while the tab is open; demo paths exist unless they're in a "missing" folder.
      return ((args?.paths as string[]) ?? []).map((p) => (p.startsWith("browser:") ? !!fileFor(p) : !/[\\/]missing[\\/]/i.test(p)));
    case "settings_get":
      try {
        return { ui: JSON.parse(localStorage.getItem("cueplay.settings") ?? "null") ?? undefined };
      } catch {
        return {};
      }
    case "settings_set":
      try {
        const patch = (args?.patch ?? {}) as { ui?: unknown };
        if (patch.ui !== undefined) localStorage.setItem("cueplay.settings", JSON.stringify(patch.ui));
      } catch {
        // Not remembered in this browser.
      }
      return;
    case "show_export_zip":
      throw new Error("Exporting a zip needs the desktop app");
    case "show_in_folder":
    case "media_watch":
    case "engine_tone":
    case "audio_set_preview_output":
    case "app_session":
    case "app_resume_dismiss":
      return;
    default:
      // show_open / show_save need the real file system.
      throw new Error(`${cmd} is only available inside the desktop app`);
  }
}

export async function mockListen(event: string, cb: Listener): Promise<() => void> {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(cb);
  if (event === "engine://state") ensureTimer();
  if (event === "engine://output") {
    // Browser mode plays through whatever Windows uses as its default output.
    setTimeout(() => cb({ outputName: "Browser · Windows default output", outputFound: true, preferred: null }), 0);
  }
  return () => listeners.get(event)?.delete(cb);
}

/** Deterministic pseudo-random analysis so the same file always looks the same. */
function fakeAnalysis(file: string): Analysis {
  if (/\.(opus|webm)$/i.test(file)) throw new Error("Unsupported format: no decoder for this codec");
  let seed = 0;
  for (const ch of file) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const duration = 30 + Math.round(rnd() * 200);
  const waveform = Array.from({ length: 1200 }, (_, i) => {
    const env = Math.min(1, i / 80) * Math.min(1, (1200 - i) / 120);
    return Math.min(1, env * (0.35 + 0.5 * Math.abs(Math.sin(i / 46)) + rnd() * 0.2));
  });
  return {
    loudness: { lufs: -24 + rnd() * 14, truePeakDb: -12 + rnd() * 9, lra: 4 + rnd() * 6, duration },
    sampleRate: 48000, channels: 2, waveform,
  };
}
