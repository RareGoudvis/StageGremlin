// Browser mode: a real (simpler) audio engine on the Web Audio API, so the UI plays sound in
// Edge/Chrome before the desktop app exists. It answers the same commands and sends the same
// `engine://state` as the Rust engine (crates/engine/src/player.rs is the reference; the
// behaviour follows it: playhead, GO guard, pre-wait, follow, passes, attached cues, vamp,
// under, Fade & GO, stop / stop all / panic, pads, rehearsal start, tones).
//
// Differences with the desktop engine, in plain words:
// - Files live in this browser tab only (see browserFiles.ts); nothing is copied on save.
// - The whole file is decoded into memory (fine for show songs, heavy for hour-long files).
// - The master "limiter" is the browser's compressor at ratio 20: close, not a brickwall.
// - Loudness is a simple K-weighted, gated measurement: within about 1 LU of a real meter.
// - No headphone preview on a second output (the browser has one output); that stays simulated.
//
// Commands it doesn't handle (YouTube, preview, resume, …) go to the simulator (mockEngine.ts).

import type { Analysis, Cue, Curve, EngineState, LogEntry, PendingInfo, PendingKind, RunningInfo, Show, ToneKind } from "../types";
import { allCues, goQueue, normGain, upgradeShow } from "../types";
import { mockInvoke, mockListen } from "./mockEngine";
import { downloadText, fileFor, isBrowserKey } from "./browserFiles";

type Listener = (p: unknown) => void;
const listeners = new Map<string, Set<Listener>>();
const emit = (event: string, payload: unknown) => listeners.get(event)?.forEach((cb) => cb(payload));

const PANIC_FADE = 0.005;
const STATE_HZ = 30;
const WAVEFORM_POINTS = 1200;

// ---------------------------------------------------------------------------------------------
// Audio context and master bus
// ---------------------------------------------------------------------------------------------

interface Master {
  ctx: AudioContext;
  input: GainNode;
  limiter: DynamicsCompressorNode;
  analysers: [AnalyserNode, AnalyserNode];
  buf: Float32Array<ArrayBuffer>;
}

let master: Master | null = null;
/** Pause all (P in Run): the whole audio context is suspended, so everything freezes in place. */
let paused = false;

/** Creates the audio graph on first use. Browsers only allow sound after a click or key press,
 *  so every command (GO, import, …) also calls resume(). */
function audio(): Master {
  if (!master) {
    const ctx = new AudioContext({ latencyHint: "interactive" });
    const input = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.08;
    input.connect(limiter);
    limiter.connect(ctx.destination);
    const split = ctx.createChannelSplitter(2);
    limiter.connect(split);
    const aL = ctx.createAnalyser();
    const aR = ctx.createAnalyser();
    aL.fftSize = aR.fftSize = 1024;
    split.connect(aL, 0);
    split.connect(aR, 1);
    master = { ctx, input, limiter, analysers: [aL, aR], buf: new Float32Array(1024) };
    applyMasterLevel();
  }
  // Commands wake the audio up (browsers start it suspended), but never out of a deliberate pause.
  if (master.ctx.state === "suspended" && !paused) void master.ctx.resume();
  return master;
}

/** The show's master fader (settings.masterDb, 0 dB = unity) on the master input. */
function applyMasterLevel() {
  if (!master) return;
  const db = eng.show?.settings.masterDb ?? 0;
  master.input.gain.setTargetAtTime(Math.pow(10, db / 20), master.ctx.currentTime, 0.02);
}

// ---------------------------------------------------------------------------------------------
// Decoding (cached per file key)
// ---------------------------------------------------------------------------------------------

const buffers = new Map<string, Promise<AudioBuffer>>();

function decode(file: string): Promise<AudioBuffer> {
  let p = buffers.get(file);
  if (!p) {
    const f = isBrowserKey(file) ? fileFor(file) : undefined;
    if (!f) {
      return Promise.reject(new Error(`file not loaded in this browser tab: import “${file.split("/").pop()}” again`));
    }
    p = f.arrayBuffer().then((data) => audio().ctx.decodeAudioData(data));
    p.catch(() => buffers.delete(file));
    buffers.set(file, p);
  }
  return p;
}

/** Already decoded? (GO must be instant, so we decode ahead and only play what's ready.) */
const ready = new Map<string, AudioBuffer>();
function prepare(file: string) {
  if (!file || ready.has(file)) return;
  decode(file).then((b) => ready.set(file, b)).catch(() => {});
}

// ---------------------------------------------------------------------------------------------
// Fades
// ---------------------------------------------------------------------------------------------

function ease(t: number, curve: Curve): number {
  if (curve === "linear") return t;
  if (curve === "exponential") return t * t; // slow start, like an exponential fade
  return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t); // S-curve (in-out)
}

/** Moves a gain from where it is now to `target` over `secs` along `curve`. */
function fadeTo(param: AudioParam, target: number, secs: number, curve: Curve) {
  const ctx = audio().ctx;
  const now = ctx.currentTime;
  const from = param.value;
  try {
    if (typeof param.cancelAndHoldAtTime === "function") param.cancelAndHoldAtTime(now);
    else param.cancelScheduledValues(now);
  } catch { /* nothing scheduled */ }
  param.setValueAtTime(from, now);
  if (secs <= 0.01 || curve === "linear") {
    param.linearRampToValueAtTime(target, now + Math.max(secs, 0.005));
    return;
  }
  const n = 64;
  const pts = new Float32Array(n);
  for (let i = 0; i < n; i++) pts[i] = from + (target - from) * ease(i / (n - 1), curve);
  try {
    param.setValueCurveAtTime(pts, now + 0.001, secs);
  } catch {
    param.linearRampToValueAtTime(target, now + secs);
  }
}

const dbToGain = (db: number) => Math.pow(10, db / 20);

// ---------------------------------------------------------------------------------------------
// Engine state
// ---------------------------------------------------------------------------------------------

interface Running {
  instance: number;
  cue: Cue;
  src: AudioBufferSourceNode;
  fade: GainNode;
  under: GainNode;
  nodes: AudioNode[];
  parent: number | null;
  pad: string | null;
  /** Trimmed start and end inside the file (seconds). */
  start: number;
  end: number;
  len: number;
  // Position bookkeeping: file position `anchorPos` at context time `anchorAt`.
  anchorAt: number;
  anchorPos: number;
  loopOn: boolean;
  loopA: number;
  loopB: number;
  pass: number;
  lastPos: number;
  fadingOut: boolean;
  stopping: boolean;
  underOn: boolean;
  vamping: boolean;
  ended: boolean;
}

interface Pending { at: number; cueId: string; kind: PendingKind; parent: number | null }

const eng = {
  show: null as Show | null,
  playhead: null as string | null,
  running: [] as Running[],
  pending: [] as Pending[],
  newLog: [] as LogEntry[],
  t0: performance.now(),
  lastGo: null as number | null,
  nextInstance: 1,
  timer: 0 as number | ReturnType<typeof setInterval>,
  tone: null as { src: AudioBufferSourceNode; gain: GainNode } | null,
  overs: 0,
};

/** Engine time in seconds. It stands still while paused, so positions, pre-waits and follows freeze too. */
let pausedAt: number | null = null;
const clock = () => ((pausedAt ?? performance.now()) - eng.t0) / 1000;

function setPaused(on: boolean) {
  if (on === paused) return;
  paused = on;
  if (on) pausedAt = performance.now();
  else if (pausedAt !== null) {
    eng.t0 += performance.now() - pausedAt; // skip the paused stretch
    pausedAt = null;
  }
}

function log(kind: string, cue: Cue | null, text: string) {
  eng.newLog.push({ clock: clock(), wallMs: Date.now(), kind, cueId: cue?.id ?? null, text });
}

function findCue(id: string): Cue | undefined {
  return eng.show ? allCues(eng.show).find((c) => c.id === id) : undefined;
}
function nextInQueue(id: string): Cue | undefined {
  if (!eng.show) return undefined;
  const q = goQueue(eng.show);
  const i = q.findIndex((c) => c.id === id);
  return i >= 0 ? q[i + 1] : undefined;
}
function childrenOf(id: string): Cue[] {
  return eng.show ? allCues(eng.show).filter((c) => c.attach?.to === id) : [];
}

/** File position (seconds) of a running sound right now. */
function filePos(r: Running): number {
  const now = audio().ctx.currentTime;
  let p = r.anchorPos + (now - r.anchorAt);
  if (r.loopOn && r.loopB > r.loopA && r.anchorPos < r.loopB && p >= r.loopB) {
    p = r.loopA + ((p - r.loopA) % (r.loopB - r.loopA));
  }
  return Math.min(p, r.end);
}

/** Turns looping on/off (or moves the loop) without losing track of the position. */
function setLoop(r: Running, on: boolean, a = r.start, b = r.end) {
  const pos = filePos(r);
  r.anchorAt = audio().ctx.currentTime;
  r.anchorPos = pos;
  r.loopOn = on;
  r.loopA = a;
  r.loopB = b;
  r.src.loop = on;
  if (on) {
    r.src.loopStart = a;
    r.src.loopEnd = b;
  } else if (!r.stopping) {
    // Not looping any more: end at the trim-out point.
    try { r.src.stop(r.anchorAt + Math.max(0, r.end - pos)); } catch { /* already stopped */ }
  }
}

// ---------------------------------------------------------------------------------------------
// Starting sounds
// ---------------------------------------------------------------------------------------------

function startSound(cue: Cue, parent: number | null, pad: string | null, from: number): number {
  const buf = ready.get(cue.file);
  if (!buf) {
    prepare(cue.file);
    throw new Error(isBrowserKey(cue.file) && fileFor(cue.file) ? "still loading, try again in a moment" : "file not loaded in this browser tab (import it again)");
  }
  const m = audio();
  const ctx = m.ctx;
  const fileLen = buf.duration;
  const start = Math.min(Math.max(cue.trimIn, 0), fileLen);
  const end = Math.min(Math.max(cue.trimOut ?? fileLen, start), fileLen);
  const len = end - start;

  const src = ctx.createBufferSource();
  src.buffer = buf;

  // gain (normalisation + trim gain) → pan → fade → under → filters → compressor → master
  const level = ctx.createGain();
  const settings = eng.show!.settings;
  level.gain.value = dbToGain(normGain(cue.loudness, settings).gainDb + cue.gainDb);
  const pan = ctx.createStereoPanner();
  pan.pan.value = Math.max(-1, Math.min(1, cue.pan));
  const fade = ctx.createGain();
  const under = ctx.createGain();
  const chain: AudioNode[] = [src, level, pan, fade, under];

  if (cue.hpf) {
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = cue.hpf;
    f.Q.value = 0.707;
    chain.push(f);
  }
  cue.eq.forEach((b, i) => {
    if (!b.on || Math.abs(b.gainDb) <= 0.01) return;
    const f = ctx.createBiquadFilter();
    f.type = i === 0 ? "lowshelf" : i === 3 ? "highshelf" : "peaking";
    f.frequency.value = b.freq;
    f.gain.value = b.gainDb;
    f.Q.value = b.q;
    chain.push(f);
  });
  if (cue.comp.on) {
    const c = ctx.createDynamicsCompressor();
    c.threshold.value = cue.comp.thresholdDb;
    c.ratio.value = Math.max(1, Math.min(20, cue.comp.ratio));
    c.knee.value = 0;
    c.attack.value = cue.comp.attackMs / 1000;
    c.release.value = cue.comp.releaseMs / 1000;
    const makeup = ctx.createGain();
    makeup.gain.value = dbToGain(cue.comp.makeupDb);
    chain.push(c, makeup);
  }
  for (let i = 0; i < chain.length - 1; i++) chain[i].connect(chain[i + 1]);
  chain[chain.length - 1].connect(m.input);

  const startAt = from > start ? Math.min(from, end) : start;
  const now = ctx.currentTime;
  // A crossfade cue fades in over the crossfade time (GO/follow cues only, not attached cues or pads).
  const fadeIn = cue.exclusive === "crossfade" && parent == null && pad == null ? Math.max(cue.fadeIn, cue.exclusiveSecs) : cue.fadeIn;
  if (fadeIn > 0 && from <= start) {
    fade.gain.setValueAtTime(0, now);
    fadeTo(fade.gain, 1, fadeIn, cue.curve);
  }

  const vamping = !!cue.vamp?.on && cue.vamp.b > cue.vamp.a;
  const instance = eng.nextInstance++;
  const r: Running = {
    instance, cue, src, fade, under, nodes: chain, parent, pad, start, end, len,
    anchorAt: now, anchorPos: startAt, loopOn: false, loopA: start, loopB: end,
    pass: 1, lastPos: startAt - start, fadingOut: false, stopping: false, underOn: false, vamping, ended: false,
  };
  src.onended = () => { r.ended = true; };
  src.start(now, startAt);
  if (vamping) setLoop(r, true, Math.max(cue.vamp!.a, start), Math.min(cue.vamp!.b, end));
  else if (cue.playCount !== 1) setLoop(r, true, start, end);
  else setLoop(r, false);
  eng.running.push(r);
  return instance;
}

function stopRunning(r: Running, secs: number, curve: Curve) {
  if (r.stopping) return;
  r.stopping = true;
  fadeTo(r.fade.gain, 0, secs, curve);
  try { r.src.stop(audio().ctx.currentTime + Math.max(secs, 0.005) + 0.02); } catch { /* already stopped */ }
}

function cleanup(r: Running) {
  try { r.src.stop(); } catch { /* fine */ }
  r.nodes.forEach((n) => n.disconnect());
}

// ---------------------------------------------------------------------------------------------
// GO and friends (same order of events as player.rs)
// ---------------------------------------------------------------------------------------------

function go(): "fired" | "ignored" | "endOfShow" {
  const guard = (eng.show?.settings.doubleGoMs ?? 300) / 1000;
  if (eng.lastGo != null && clock() - eng.lastGo < guard) return "ignored";
  const id = eng.playhead;
  if (!id) return "endOfShow";
  eng.lastGo = clock();
  goCue(id, "go");
  return "fired";
}

function goCue(id: string, kind: string) {
  const cue = findCue(id);
  if (!cue) return;
  eng.playhead = nextInQueue(id)?.id ?? null;
  // Exclusive cue: what is already playing stops or fades, and its timers are cancelled.
  const fade = cue.exclusive === "stop" ? 0.02 : cue.exclusive === "fade" || cue.exclusive === "crossfade" ? Math.max(0.02, cue.exclusiveSecs) : null;
  if (fade != null) {
    for (const r of eng.running) stopRunning(r, fade, r.cue.curve);
    eng.pending = [];
  }
  log(kind, cue, `${cue.number} ${cue.name}`);
  if (cue.preWait > 0) eng.pending.push({ at: clock() + cue.preWait, cueId: cue.id, kind: "preWait", parent: null });
  else fire(cue, null);
}

function fire(cue: Cue, parent: number | null) {
  let instance: number;
  try {
    instance = startSound(cue, parent, null, 0);
  } catch (e) {
    log("skip", cue, `${cue.number} ${cue.name}: ${(e as Error).message}`);
    // A missing file must not stall an automatic sequence.
    if (cue.follow.kind !== "none" && parent == null) {
      const next = nextInQueue(cue.id);
      if (next) goCue(next.id, "auto");
    }
    return;
  }
  for (const ch of childrenOf(cue.id)) {
    const at = (ch.attach?.at ?? 0) - cue.trimIn;
    if (at >= 0) eng.pending.push({ at: clock() + at + ch.preWait, cueId: ch.id, kind: "attached", parent: instance });
  }
  if (cue.follow.kind === "afterStart") {
    const next = nextInQueue(cue.id);
    if (next) eng.pending.push({ at: clock() + Math.max(0, cue.follow.delay), cueId: next.id, kind: "follow", parent: null });
  }
}

function stopChildren(parent: number) {
  eng.pending = eng.pending.filter((p) => p.parent !== parent);
  for (const r of eng.running) {
    if (r.parent === parent && !r.stopping) {
      stopRunning(r, r.cue.stopFade, r.cue.curve);
      stopChildren(r.instance);
    }
  }
}

function stopCue(cueId: string) {
  for (const r of eng.running) {
    if (r.cue.id !== cueId || r.stopping) continue;
    stopRunning(r, r.cue.stopFade, r.cue.curve);
    log("stop", r.cue, `${r.cue.number} ${r.cue.name}`);
    stopChildren(r.instance);
  }
  eng.pending = eng.pending.filter((p) => p.cueId !== cueId);
}

function stopEverything(secs: number, curve: Curve) {
  for (const r of eng.running) stopRunning(r, secs, curve);
  eng.pending = [];
  stopTone();
}

function playPad(padId: string) {
  const pad = eng.show?.pads.find((p) => p.id === padId);
  if (!pad) return;
  const playing = eng.running.filter((r) => r.pad === padId && !r.stopping);
  for (const r of playing) stopRunning(r, pad.mode === "oneShot" ? 0.02 : r.cue.stopFade, r.cue.curve);
  if (playing.length && pad.mode !== "oneShot") {
    log("pad", pad.cue, `pad ${pad.cue.name} off`);
    return;
  }
  const cue: Cue = { ...pad.cue, follow: { kind: "none" }, playCount: pad.mode === "loop" ? 0 : 1 };
  try {
    startSound(cue, null, pad.id, 0);
    log("pad", cue, `pad ${cue.name}`);
  } catch (e) {
    log("skip", cue, `pad ${cue.name}: ${(e as Error).message}`);
  }
}

function goFrom(cueId: string, at: number) {
  const cue = findCue(cueId);
  if (!cue) return;
  eng.playhead = nextInQueue(cueId)?.id ?? null;
  log("rehearsal", cue, `${cue.number} ${cue.name} from ${at.toFixed(1)} s`);
  try {
    startSound(cue, null, null, at);
  } catch (e) {
    log("skip", cue, `${cue.number} ${cue.name}: ${(e as Error).message}`);
  }
}

function toggleUnder(cueId: string | null) {
  const s = eng.show?.settings;
  if (!s) return;
  const target = cueId ?? [...eng.running].reverse().find((r) => !r.stopping && r.parent == null)?.cue.id;
  if (!target) return;
  for (const r of eng.running) {
    if (r.cue.id !== target || r.stopping) continue;
    r.underOn = !r.underOn;
    const db = r.underOn ? (r.cue.underDb ?? s.underDb) : 0;
    fadeTo(r.under.gain, dbToGain(db), s.underFade, "sCurve");
  }
}

function releaseVamp(cueId: string | null) {
  for (const r of eng.running) {
    if (!r.vamping || (cueId && r.cue.id !== cueId)) continue;
    r.vamping = false;
    if (r.cue.playCount === 1) setLoop(r, false);
    else setLoop(r, true, r.start, r.end);
    r.lastPos = filePos(r) - r.start;
  }
}

// ---- tones (Preflight calibration) ----

function makeTone(kind: ToneKind): AudioBuffer {
  const ctx = audio().ctx;
  const sr = ctx.sampleRate;
  const secs = kind === "pink" ? 10 : 1;
  const buf = ctx.createBuffer(2, sr * secs, sr);
  if (kind === "line") {
    // 1 kHz sine at −20 dBFS. 1 s holds a whole number of cycles, so the loop is seamless.
    const amp = dbToGain(-20);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < d.length; i++) d[i] = amp * Math.sin((2 * Math.PI * 1000 * i) / sr);
    }
  } else {
    // Pink noise (Paul Kellet's filter), scaled to about −14 LUFS (RMS ≈ −14 dBFS per channel).
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, sum = 0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
        b6 = w * 0.115926;
        sum += d[i] * d[i];
      }
      const scale = dbToGain(-14 - 3) / Math.sqrt(sum / d.length); // −3 dB: two channels add up
      for (let i = 0; i < d.length; i++) d[i] *= scale;
    }
  }
  return buf;
}

function startTone(kind: ToneKind) {
  stopTone();
  const m = audio();
  const src = m.ctx.createBufferSource();
  src.buffer = makeTone(kind);
  src.loop = true;
  const gain = m.ctx.createGain();
  src.connect(gain).connect(m.input);
  src.start();
  eng.tone = { src, gain };
  log("tone", null, `tone ${kind} on`);
}

function stopTone() {
  const t = eng.tone;
  if (!t) return;
  eng.tone = null;
  fadeTo(t.gain.gain, 0, 0.2, "linear");
  try { t.src.stop(audio().ctx.currentTime + 0.25); } catch { /* fine */ }
}

// ---------------------------------------------------------------------------------------------
// The tick (~30 Hz): timers, passes, end fades, finished sounds, state out
// ---------------------------------------------------------------------------------------------

function tick() {
  const now = clock();
  eng.pending.sort((a, b) => a.at - b.at);
  while (eng.pending.length && eng.pending[0].at <= now) {
    const p = eng.pending.shift()!;
    const cue = findCue(p.cueId);
    if (!cue) continue;
    if (p.kind === "preWait") fire(cue, null);
    else if (p.kind === "follow") goCue(cue.id, "auto");
    else if (eng.running.some((r) => r.instance === p.parent && !r.stopping)) {
      log("attached", cue, `${cue.number} ${cue.name}`);
      fire(cue, p.parent);
    }
  }

  const finished: Running[] = [];
  for (const r of eng.running) {
    const pos = filePos(r) - r.start;
    if (!r.vamping && r.loopOn && pos + 0.05 < r.lastPos) {
      r.pass += 1;
      if (r.cue.playCount !== 0 && r.pass >= r.cue.playCount) setLoop(r, false);
    }
    r.lastPos = pos;
    const lastPass = r.cue.playCount !== 0 && r.pass >= r.cue.playCount;
    if (lastPass && !r.vamping && !r.fadingOut && !r.stopping && r.cue.fadeOut > 0 && pos >= r.len - r.cue.fadeOut) {
      fadeTo(r.fade.gain, 0, Math.max(0.01, r.len - pos), r.cue.curve);
      r.fadingOut = true;
    }
    if (r.ended) finished.push(r);
  }
  for (const r of finished) {
    eng.running = eng.running.filter((x) => x !== r);
    cleanup(r);
    stopChildren(r.instance);
    if (!r.stopping && r.parent == null && r.pad == null && r.cue.follow.kind === "afterEnd") {
      const next = nextInQueue(r.cue.id);
      if (next) goCue(next.id, "auto");
    }
  }

  // Decode the standing-by cue, the two after it and their attached cues ahead of GO.
  let id = eng.playhead;
  for (let i = 0; i < 3 && id; i++) {
    const c = findCue(id);
    if (c) {
      prepare(c.file);
      childrenOf(id).forEach((ch) => prepare(ch.file));
    }
    id = nextInQueue(id)?.id ?? null;
  }

  emit("engine://state", state());
}

function peak(a: AnalyserNode, buf: Float32Array<ArrayBuffer>): number {
  a.getFloatTimeDomainData(buf);
  let p = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = Math.abs(buf[i]);
    if (v > p) p = v;
  }
  return p;
}

function state(): EngineState {
  const running: RunningInfo[] = eng.running.map((r) => {
    const pos = Math.max(0, filePos(r) - r.start);
    const abs = r.start + pos;
    const marker = r.cue.markers.filter((m) => m.t > abs).sort((a, b) => a.t - b.t)[0];
    const passesLeft = r.cue.playCount === 0 ? 0 : Math.max(0, r.cue.playCount - r.pass);
    return {
      instance: r.instance, cueId: r.cue.id, number: r.cue.number, name: r.cue.name,
      position: pos, length: r.len, remaining: Math.max(0, r.len - pos) + passesLeft * r.len,
      pass: r.pass, playCount: r.cue.playCount, under: r.underOn, vamping: r.vamping, stopping: r.stopping,
      attached: r.parent != null, padId: r.pad, duckBg: r.cue.duckBg && !r.stopping,
      nextMarker: marker ? [marker.label, marker.t - abs] : null,
    };
  });
  const now = clock();
  const pending: PendingInfo[] = eng.pending.map((p) => ({ cueId: p.cueId, kind: p.kind, inSecs: Math.max(0, p.at - now) }));
  let meter = { peakL: 0, peakR: 0, grDb: 0, overs: 0 };
  if (master) {
    const peakL = peak(master.analysers[0], master.buf);
    const peakR = peak(master.analysers[1], master.buf);
    const ceiling = dbToGain(eng.show?.settings.limiterCeilingDb ?? -1);
    if (peakL > ceiling || peakR > ceiling) eng.overs += 1;
    meter = { peakL, peakR, grDb: Math.max(0, -master.limiter.reduction), overs: eng.overs };
  }
  const s: EngineState = { clock: now, playhead: eng.playhead, running, pending, meter, newLog: eng.newLog, paused };
  eng.newLog = [];
  return s;
}

function ensureTimer() {
  if (!eng.timer) eng.timer = setInterval(tick, 1000 / STATE_HZ);
}

// ---------------------------------------------------------------------------------------------
// Analysis: duration, peak, K-weighted gated loudness, waveform
// ---------------------------------------------------------------------------------------------

const analysisCache = new Map<string, Promise<Analysis>>();

function analyze(file: string): Promise<Analysis> {
  let p = analysisCache.get(file);
  if (!p) {
    p = decode(file).then(measure);
    p.catch(() => analysisCache.delete(file));
    analysisCache.set(file, p);
  }
  return p;
}

async function measure(buf: AudioBuffer): Promise<Analysis> {
  const chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));

  // Peak (sample peak; a real true-peak meter reads up to ~0.5 dB higher).
  let pk = 0;
  for (const d of chans) for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > pk) pk = v; }

  // Waveform overview: the loudest sample in each slice, 0…1.
  const waveform: number[] = new Array(WAVEFORM_POINTS).fill(0);
  const per = buf.length / WAVEFORM_POINTS;
  for (const d of chans) {
    for (let w = 0; w < WAVEFORM_POINTS; w++) {
      let m = waveform[w];
      const end = Math.min(d.length, Math.floor((w + 1) * per));
      for (let i = Math.floor(w * per); i < end; i++) { const v = Math.abs(d[i]); if (v > m) m = v; }
      waveform[w] = m;
    }
  }

  // Loudness (EBU R128, simplified): K-weighting through an offline render, then 400 ms blocks
  // every 100 ms, absolute gate −70 LUFS, relative gate −10 LU.
  let lufs = -Infinity;
  try {
    const off = new OfflineAudioContext(buf.numberOfChannels, buf.length, buf.sampleRate);
    const src = off.createBufferSource();
    src.buffer = buf;
    const shelf = off.createBiquadFilter();
    shelf.type = "highshelf";
    shelf.frequency.value = 1681;
    shelf.gain.value = 4;
    const hp = off.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 38;
    hp.Q.value = 0.5;
    src.connect(shelf).connect(hp).connect(off.destination);
    src.start();
    const k = await off.startRendering();
    const kch = Array.from({ length: k.numberOfChannels }, (_, i) => k.getChannelData(i));
    const block = Math.round(0.4 * k.sampleRate);
    const hop = Math.round(0.1 * k.sampleRate);
    const blocks: number[] = []; // mean square summed over channels
    for (let s = 0; s + block <= k.length; s += hop) {
      let z = 0;
      for (const d of kch) {
        let acc = 0;
        for (let i = s; i < s + block; i++) acc += d[i] * d[i];
        z += acc / block;
      }
      blocks.push(z);
    }
    const toL = (z: number) => -0.691 + 10 * Math.log10(z);
    const abs = blocks.filter((z) => z > 0 && toL(z) > -70);
    if (abs.length) {
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      const rel = toL(mean(abs)) - 10;
      const gated = abs.filter((z) => toL(z) > rel);
      if (gated.length) lufs = toL(mean(gated));
    }
  } catch {
    // Leave lufs at -Infinity: the cue plays unnormalised.
  }

  return {
    loudness: { lufs: Number.isFinite(lufs) ? lufs : -70, truePeakDb: pk > 0 ? 20 * Math.log10(pk) : -96, lra: 0, duration: buf.duration },
    sampleRate: buf.sampleRate,
    channels: buf.numberOfChannels,
    waveform,
  };
}

// ---------------------------------------------------------------------------------------------
// Entry points (called from tauri.ts when not inside the desktop app)
// ---------------------------------------------------------------------------------------------

export async function webInvoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  switch (cmd) {
    case "engine_set_show": {
      eng.show = args?.show as Show;
      const q = goQueue(eng.show);
      if (!eng.playhead || !q.some((c) => c.id === eng.playhead)) eng.playhead = q[0]?.id ?? null;
      const ids = new Set(allCues(eng.show).map((c) => c.id));
      eng.pending = eng.pending.filter((p) => ids.has(p.cueId));
      eng.show.pads.forEach((p) => prepare(p.cue.file));
      applyMasterLevel();
      ensureTimer();
      return mockInvoke(cmd, args); // keep the simulator's copy in sync for preview / YouTube
    }
    case "engine_go":
      // GO while paused resumes everything instead of firing the next cue.
      if (paused) {
        setPaused(false);
        audio();
        log("resume", null, "Resumed");
        return "ignored";
      }
      audio();
      return go();
    case "engine_pause_all": {
      const m = audio();
      setPaused(!paused);
      if (paused) void m.ctx.suspend();
      else void m.ctx.resume();
      log(paused ? "pause" : "resume", null, paused ? "Paused everything" : "Resumed");
      return paused;
    }
    case "engine_stop_all":
      stopEverything(eng.show?.settings.stopAllFade ?? 2, "sCurve");
      log("stopAll", null, "Stop all");
      return;
    case "engine_panic":
      stopEverything(PANIC_FADE, "linear");
      log("panic", null, "Panic");
      return;
    case "engine_stop_cue":
      return stopCue(String(args?.cueId));
    case "engine_toggle_under":
      return toggleUnder((args?.cueId as string | null) ?? null);
    case "engine_release_vamp":
      return releaseVamp((args?.cueId as string | null) ?? null);
    case "engine_set_playhead": {
      const id = (args?.cueId as string | null) ?? null;
      eng.playhead = id && findCue(id) ? id : null;
      return;
    }
    case "engine_pad":
      audio();
      return playPad(String(args?.padId));
    case "engine_go_from":
      audio();
      return goFrom(String(args?.cueId), Number(args?.at ?? 0));
    case "engine_tone": {
      const kind = (args?.kind as ToneKind | null) ?? null;
      if (kind) startTone(kind);
      else stopTone();
      return;
    }
    case "analyze_file":
      audio();
      return analyze(String(args?.file));
    case "show_save": {
      const show = args?.show as Show;
      const name = String(args?.path ?? "show.sg").split(/[\\/]/).pop() || "show.sg";
      downloadText(name, JSON.stringify(show, null, 2));
      return show;
    }
    case "show_open": {
      const f = fileFor(String(args?.path));
      if (!f) throw new Error("pick the .sg file again");
      return upgradeShow(JSON.parse(await f.text()) as Show);
    }
    case "app_info":
      return { version: "browser", portable: false, dataDir: "(browser)" };
    default:
      return mockInvoke(cmd, args);
  }
}

export function webListen(event: string, cb: Listener): Promise<() => void> {
  if (event !== "engine://state") return mockListen(event, cb);
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(cb);
  ensureTimer();
  return Promise.resolve(() => listeners.get(event)?.delete(cb));
}
