# StageGremlin — start prompt for Claude Code (VS Code)

Paste everything below the line into Claude Code, with the StageGremlin folder open in VS Code.

---

You're working on **StageGremlin**, a QLab-style audio cue player for Windows that I (Ruben) use to run sound at my
school's shows (schoolfeest). One stereo feed goes to an Allen & Heath Qu-24 mixer over USB; GO is the laptop's
spacebar. It's a Tauri 2 app: Rust audio engine (kira) + React/TypeScript UI. Repo: `RareGoudvis/StageGremlin` (public, AGPL-3.0).

**Read these first, in this order, before changing anything:**
1. `CLAUDE.md` — layout, rules, status, known limitations.
2. `docs/brief.md` — the full v1 spec (the brief wins when code and brief disagree; ask me before changing direction).
3. `docs/ipc.md` — every Tauri command and event between UI and Rust.
4. `docs/ui-v2.md` + `docs/mockups/*.dc.html` — the approved, NOT yet built decluttered UI (next big job).
5. `docs/TESTING.md` — the Windows test plan.

**How I work (please follow):**
- I direct and read code but don't write modern syntax myself. Explain changes in plain words, keep code plain,
  comment the *why*, prefer small files. Short answers; no long recaps.
- English in chat by default. The app's UI must stay in **both English and Dutch** (`src/i18n.ts`): every new label
  gets an EN and an NL string.
- Commit to `main` freely with clear messages. **Never start a build unless I say "build".** A build runs locally:
  push `main`, then `scripts/release.ps1` builds the portable zip + installer and publishes a GitHub Release with
  `gh`. I want to group many fixes into one build. Don't use GitHub Actions for builds (manual backup only).
- Before every commit: `cargo test -p cueplay-engine`, `cargo clippy -p stagegremlin`, `npm run build` must all pass.
- Don't touch the background-player Windows volume code (`src-tauri/src/background/session_volume_win.rs`) unless
  the task is about it; it's delicate.
- The app name is **StageGremlin** (one word), show files are **.sg** (old `.cueplay` still opens). Internal crate
  `cueplay-engine` keeps its name.

**Current state (26 Oct 2026):**
- v0.1.0 build 7 was tested on Windows: core playback works.
- Since then, on `main` and not built yet: themed right-click menus (WebView2's own menu is off), a full Settings
  screen, rebindable Run keys, Dumbo mode (simplified operator screen), `.sg` files, smaller download (no ffprobe).

**Next jobs, in order — do one, show me, then continue:**
1. Rebuild the UI to match `docs/ui-v2.md`: File menu on the show name, one `+ Add` button with the Add window
   (files / YouTube & lists / pad / section), left rail Cues · Pads · Media, one toolbar + View menu, selection bar
   for multi-select, inspector tabs Basics · Sound · Timing · Notes, Settings regrouped into This laptop / This show / Tools.
   Reuse existing components and logic; this is a layout reshuffle, not a rewrite.
2. Then wait for my test notes from `docs/TESTING.md` and fix those.

To run it locally: `npm install`, then `npm run tauri dev`. Start by reading the files above and tell me in a few
lines what you understood and what you'll do first.
