# UI v2 — decluttered Build + Settings (built on main, 26 Oct 2026; not yet tested in the app)

Differences from the mockup, decided while building: Media is a full view (no drag from the bin to the list;
drag files from Explorer onto the window, or use "Add to show"); the theme button left the top bar (Settings ›
Language & look, Ctrl+T); the master fader stays in the top bar only.

Clickable mockup: https://claude.ai/artifact/XcY6ae8GSgNG1yoA6H6tiv (the source of both screens is in
`docs/mockups/` — open the `.dc.html` files in a text editor; they are plain HTML + a small JS class).

Goal: the Build screen had ~20 buttons. Keep only what you use every minute on screen; the rest goes to the
File menu, a View menu, the selection bar and the right-click menus (which already exist).

## Top bar (all modes)
- Logo STAGE**GREMLIN** · **show name button = File menu** ("Schoolfeest 2027 · saved ▾"): New (Ctrl+N), Open… (Ctrl+O),
  Open recent ›, Save (Ctrl+S), Save as… (Ctrl+Shift+S), Export show as zip…, Print cue sheet… (Ctrl+P), Settings… (Ctrl+,).
- Mode switch BUILD / PREFLIGHT / RUN · spacer · output chip (● Qu-24 USB) · clock · master meter (+ fader) ·
  Background pill (cyan, opens the background player) · gear (Settings). BOOTH menu only in Run.
- Show progress strip under it.

## Build
- **Left rail** (76 px, icons + labels): Cues · Pads · Media. Media bin is no longer a permanent pane.
- **One toolbar**: `+ Add` (primary, lime) · search field ("Find a cue… Ctrl+K") · spacer · Undo · Redo · `View ▾`
  (Collapse all sections, Show full file paths, Renumber all cues…, + New section).
- **Selection bar**: when 2+ cues are selected the toolbar is replaced by a dark bar: "N cues selected · changes apply
  to all of them" · Colour · Move to section · Duplicate · Delete · ✕ (clear selection).
- Cue rows: number, colour dot, name + one-line note, one badge max (STANDBY / LOOP / +x dB peak-limited / missing),
  length. Everything else via right-click.
- **Add window** (modal, one place for every import): pill tabs Audio files · YouTube & lists · Soundboard pad · Section.
  Footer: "Add to [After cue 3 · Klas 3A & 3B ▾]" · link "Import settings…" (opens Settings › Import & tools) · primary button.
- **Inspector** (380 px): number + name, big `OPEN CUE EDITOR · Enter` button, then tabs **Basics · Sound · Timing · Notes**
  instead of one long scroll. Basics = file card (path, LUFS/peak/length, normalisation badge), colour, fade in/out, gain,
  "after this cue". Sound = quick presets (EQ, high-pass, compressor, under). Timing = pre-wait, play count, follow, Fade & GO,
  attach, duck background. Notes = Sound / LX / Stage.
- Footer tip line: "Right-click a cue or section for everything else."

## Settings (full page, "Back to Build", Esc closes, saves by itself)
Left nav grouped by where the setting is stored:
- **THIS LAPTOP**: Audio & output (show output + status + Refresh + "switching cuts sound" warning + fallback checkbox;
  headphone preview device; test tones; limiter ceiling) · Run & booth (**Dumbo mode** as a big dark card with ON/OFF,
  PIN option, pads row option, background locked in Run, red night mode) · Language & look (EN/NL, theme, name/path,
  interface size) · Shortcuts.
- **THIS SHOW** (stored in the .sg): Levels & fades (loudness target, peak ceiling, stop-all fade, under level/fade,
  double-GO guard — each with a one-line explanation) · Background music (duck to/time, restore time, wait, auto-duck).
- **TOOLS**: Import & tools (copy into media folder, measure loudness on import, YouTube format, yt-dlp version + Update,
  ffmpeg status + Reinstall) · About (version, portable, data folder, AGPL-3.0, repo).

Keep the existing theme tokens (`src/styles.css`), fonts and the i18n (EN + NL) for every new label.
