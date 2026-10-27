# StageGremlin — notes for Claude Code

QLab-style audio cue player for Windows, built for school shows (schoolfeest). One stereo output to the
mixer (Allen & Heath Qu-24 over USB). GO is the laptop's spacebar. Portable build is the main build.

**The brief is the spec:** <https://claude.ai/code/artifact/30a008c9-2b00-48a7-a945-75b6c2bb24b9>
(a copy may be in `docs/brief.md`). Where the code and the brief disagree, ask the owner before changing direction.
Design reference: "Cueplay — alternate take" (Build → Preflight → Run, OLED black for Run, light for Build).

The owner is a teacher who directs AI-written code: he reads and scopes it but doesn't write modern syntax.
Keep code plain, comment the *why*, prefer small files, explain trade-offs in plain words.

## Layout

```
crates/engine/      Rust: show model (.sg JSON; old .cueplay files still open), playback (kira), master limiter + meters, loudness analysis
  src/show.rs       Show / Section / Cue, normalisation maths, load/save (copies media into media/, backups/)
  src/player.rs     Engine: playhead, GO, pre-wait, follow triggers, attached cues, passes, vamp, under, stop/panic
  src/dsp.rs        Lookahead brickwall limiter on the master bus; publishes peak + gain reduction
  src/analysis.rs   EBU R128 loudness, true peak, LRA, waveform overview (symphonia + ebur128)
  tests/engine.rs   Engine tests on kira's mock backend (no sound card needed)
src-tauri/          Tauri 2 shell: engine thread, commands, events, portable mode, keep-awake
src/                React + TypeScript UI (Vite, Zustand). src/types.ts mirrors the Rust types
docs/ipc.md         The UI ↔ core contract: every command and event
.github/workflows/  Backup cloud build (manual "Run workflow" only)
scripts/release.ps1 Local release: build portable zip + installer, publish a GitHub Release with gh
```

## Rules that matter

- **Nothing may interrupt audio.** Kira mixes on its own thread. The engine lives on one dedicated thread in
  src-tauri; UI calls go through a channel. Never do file I/O or analysis on the engine thread.
- **One command per action.** Buttons, menus, keys and (later) a remote all call the same Tauri command.
- **The UI owns the show document while editing** (undo/redo in the store) and sends the whole show to the
  engine with `engine_set_show` after each change. The engine owns playback state and streams it at ~30 Hz.
- Keep `src/types.ts` in sync with `crates/engine/src/show.rs` / `player.rs` (camelCase JSON, serde defaults
  on every field so old show files keep opening).
- Loudness: target −14 LUFS, peak cap −1 dBTP (normalisation never pushes a true peak over it), master limiter
  ceiling −1 dBTP. See `show::norm_gain`.
- Run mode is locked: no editing. Space = GO even when a button has focus; Esc = Stop all; Esc Esc = Panic.

## Audio paths (what the master limiter covers)

- Cues and pads → engine (kira) → master limiter → show output (Qu-24). Covered.
- Background music → WebView2 window → **Windows default output device**, not the show output; never through
  the limiter. It only reaches the desk when the Qu-24 is the Windows default (Preflight checks this:
  `audio_default_output`; button opens Windows sound settings).
- Headphone preview → second engine → its own device. Not the limiter, by design (never the hall).
- AUDAC zones / Streambox → outside StageGremlin.

## Commands

```
npm install
npm run tauri dev                         # run the app with hot reload
npm run tauri build                       # release build → target/release/StageGremlin.exe (+ NSIS installer)
scripts/release.ps1                       # only when the owner says "build": push main first; builds + publishes a Release
cargo test -p cueplay-engine              # engine tests (no audio device needed)
npm run build                             # type-check + build the UI
```

## Status (v0.1.0, 26 Oct 2026)

Everything in the brief is written; NOTHING has been tested on Windows or with the real Qu-24 yet.
`docs/TESTING.md` is the test plan. Code that only runs on Windows (background volume sessions, keep-awake,
explorer /select, WebView2 data dir, yt-dlp/ffmpeg) compiles but is untested.

- Engine (tested on kira's mock backend): playhead, GO + double-press guard, pre-wait, follow, passes, attached cues,
  vamp/release, under, Fade & GO, pads, rehearsal start-at, pause all, master fader, calibration tones, limiter with
  live ceiling, peak + short-term loudness meters, pre-opening the next cues' files, save/open/backups/export zip.
- Shell: engine thread, output device by name + fallback, headphone preview engine, crash resume file, USB-dropout
  rescue, YouTube (yt-dlp/ffmpeg install, resolve, download, convert), media watcher, per-machine settings.
- Background player: WebView2 window per source, Windows audio-session volume fades, auto-duck, track list, per-show config.
- UI (v2 layout, docs/ui-v2.md): File menu on the show name (incl. Open recent), Build rail Cues · Pads · Media,
  one toolbar (+ Add, search Ctrl+K, Undo/Redo, View menu), selection bar for 2+ cues, Add window (files / YouTube &
  lists / pad / section), inspector tabs Basics · Sound · Timing · Notes, bulk edit, cut/copy/paste; cue editor
  (waveform handles, EQ/comp curves, preview), Preflight, Run (rail, now playing, up next, Make next, swap, dock),
  booth modes, print, full-page Settings grouped This laptop / This show / Tools (NL/EN, rebindable shortcuts),
  resume dialog. v2 layout is untested in the real app.
- AUDAC MTX88 remote (outside the v1 brief, asked for by the owner): zones' input / volume / mute over TCP 5001,
  reads the MTX's own names (GN1–GN30, found in its web portal), does not lock others out; top-bar AUDAC button, Run dock tab, Settings › AUDAC. `scripts/fake-mtx.py`
  stands in for the box. Schedule (Settings › Schedule): times per weekday that set zones and start a background
  playlist; runs while the app is open. AUDAC setup + schedule need the admin password (one per build, hash in the
  gitignored .env.local via scripts/make-admin-hash.mjs). Untested on the real MTX.
- Update check (GitHub releases vs the build's own tag, banner outside Run) and the app icon from docs/brand/.
- Browser mode (no Tauri): real sound through Web Audio (`src/lib/webAudioEngine.ts`); YouTube/background simulated.

Next: run docs/TESTING.md on Windows, fix what breaks; Run keys (Space/Esc/S/U/V) aren't rebindable yet
(RunView still reads fixed keys); M0 Widevine results decide which background sources stay.

## Known limitations / next steps

- Output device: chosen by name (default "Qu-24", per machine in `<dataDir>/settings.json`), falling back to the
  Windows default when missing; switches back while idle. USB dropout mid-show: kira moves running sound to the default
  output itself; src-tauri logs it and, as a safety net, rebuilds + restarts cues at their last positions if sound
  stalls. Untested on the real Qu-24 (M0/M8 dry run still needed).
- Kira's streaming decoder buffers ~0.34 s ahead, so loop/vamp changes land that late. Fine for songs; very short
  repeating jingles may play one pass too many. If that matters, play short multi-pass cues as static sounds.
- "GO within 20 ms" needs pre-loading the standing-by cue (open the file and prime the decoder before GO).
