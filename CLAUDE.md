# RG CuePlay — notes for Claude Code

QLab-style audio cue player for Windows, built for school shows (schoolfeest). One stereo output to the
mixer (Allen & Heath Qu-24 over USB). GO is the laptop's spacebar. Portable build is the main build.

**The brief is the spec:** <https://claude.ai/code/artifact/30a008c9-2b00-48a7-a945-75b6c2bb24b9>
(a copy may be in `docs/brief.md`). Where the code and the brief disagree, ask the owner before changing direction.
Design reference: "Cueplay — alternate take" (Build → Preflight → Run, OLED black for Run, light for Build).

The owner is a teacher who directs AI-written code: he reads and scopes it but doesn't write modern syntax.
Keep code plain, comment the *why*, prefer small files, explain trade-offs in plain words.

## Layout

```
crates/engine/      Rust: show model (.cueplay JSON), playback (kira), master limiter + meters, loudness analysis
  src/show.rs       Show / Section / Cue, normalisation maths, load/save (copies media into media/, backups/)
  src/player.rs     Engine: playhead, GO, pre-wait, follow triggers, attached cues, passes, vamp, under, stop/panic
  src/dsp.rs        Lookahead brickwall limiter on the master bus; publishes peak + gain reduction
  src/analysis.rs   EBU R128 loudness, true peak, LRA, waveform overview (symphonia + ebur128)
  tests/engine.rs   Engine tests on kira's mock backend (no sound card needed)
src-tauri/          Tauri 2 shell: engine thread, commands, events, portable mode, keep-awake
src/                React + TypeScript UI (Vite, Zustand). src/types.ts mirrors the Rust types
docs/ipc.md         The UI ↔ core contract: every command and event
.github/workflows/  Windows build (portable zip + installer) on GitHub Actions
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

## Commands

```
npm install
npm run tauri dev                         # run the app with hot reload
npm run tauri build                       # release build → target/release/rg-cueplay.exe (+ NSIS installer)
cargo test -p cueplay-engine              # engine tests (no audio device needed)
npm run build                             # type-check + build the UI
```

## Status (see the brief's milestones)

- [x] M1 engine core: cues in sections, GO / stop / panic with fades, trim, pre-wait, follow (after end / after
      start), passes, attached cues, vamp + release, under, Fade & GO, save/open with media copy and backups
- [x] M2 partly: per-cue high-pass, 4-band EQ, compressor (kira effects); R128 analysis with peak cap; master
      limiter + meters. Missing: live EQ/compressor curves in the editor
- [ ] M0 spikes on the real laptop: Qu-24 output, WebView2 + Widevine for Spotify / YouTube Music / Beatport / Soundtrack
- [ ] M3 cue editor (waveform drag handles for trim/fades/vamp/markers/attach), headphone preview (second output)
- [ ] M4 Run polish: pads dock, background dock, emergency swap, print cue sheet
- [ ] M5 YouTube import (yt-dlp + ffmpeg sidecars)
- [ ] M6 background player (WebView2 window, Windows audio session volume for duck/restore)
- [ ] M7 Preflight checks + calibration tone + failure drills, booth (dimmer, red mode, Big mode)
- [ ] M8 show-proofing: crash resume, USB dropout fallback to laptop output, full dry run on the rig

## Known limitations / next steps

- Output device: chosen by name (default "Qu-24", per machine in `<dataDir>/settings.json`), falling back to the
  Windows default when missing; switches back while idle. USB dropout mid-show: kira moves running sound to the default
  output itself; src-tauri logs it and, as a safety net, rebuilds + restarts cues at their last positions if sound
  stalls. Untested on the real Qu-24 (M0/M8 dry run still needed).
- Kira's streaming decoder buffers ~0.34 s ahead, so loop/vamp changes land that late. Fine for songs; very short
  repeating jingles may play one pass too many. If that matters, play short multi-pass cues as static sounds.
- "GO within 20 ms" needs pre-loading the standing-by cue (open the file and prime the decoder before GO).
