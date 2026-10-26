<!-- Exported from the online brief: https://claude.ai/code/artifact/30a008c9-2b00-48a7-a945-75b6c2bb24b9 . The online version wins if they differ. -->

# RG CuePlay — v1 brief

Oct 19, 2026 · @Ruben Van Handenhove

## Summary

RG CuePlay is a Windows desktop app that plays a show's audio cues one by one with a GO button, sending one stereo feed to the mixer (Qu-24 over USB). It takes QLab's cue-list workflow, keeps only what a school show needs, and adds YouTube import, a soundboard and a background music player that ducks under show cues.

**Design:** [Cueplay — alternate take](https://claude.ai/artifact/MNNCA91dVb1bPHShTKDUR8) is the design to build from: Build → Preflight → Run, the section rail, the cue editor and the booth features. The first [Cue Player mockup](https://claude.ai/artifact/WrdJNX8czhriTRAmK2Socr) stays as a reference for the import, save, print and settings dialogs. Where a mockup and this text disagree, this text wins.

**Who uses it:** one operator at the sound desk during a school event (schoolfeest, proclamation, sports day), and the same person preparing the show at home beforehand.

**In v1:**

- Build, Preflight and Run: one app in three steps, with Run designed for a dark booth
- A cue list with sections, reordering, numbering, colours and Sound / LX / Stage notes
- A cue editor: waveform with drag handles for trim, fades, vamp loop, song markers and attached cues; 4-band EQ with presets; compressor
- Loudness normalisation to −14 LUFS on import, a master peak limiter and meters
- Run: section rail, now playing with countdowns, scrollable up next with Make next, Fade & GO, Under, Vamp, emergency swap and headphone preview
- A soundboard (pads) and a show log, in one dock beside GO
- A background player (Spotify, YouTube Music, Beatport or Soundtrack in a built-in browser) with duck, restore and play/pause
- Import from files, YouTube links, playlists and pasted lists; save as .cueplay; print a cue sheet
- Preflight checks, desk calibration, failure drills, rehearsal mode and crash resume
- Booth: OLED black and light themes, dimmer, red mode, Big mode; GO on the laptop's spacebar
- Portable build and installer

**Not in v1:** MIDI, OSC or HTTP control, video, lighting, more than one show output (there is the show output plus the laptop's headphone preview, nothing else), per-cue routing to separate channels, reverb and delay, built-in remote control, multi-user editing.

## Stack and architecture

A Tauri 2 app: the interface is Vite + React, and everything that touches audio, files or Windows runs in Rust, so a busy UI can never interrupt playback.

(architecture diagram: UI → command layer → Rust core → output; see the online brief)

The UI never plays audio itself; it sends commands and redraws from the state events the core sends back.

- **Audio engine:** the kira crate, one mixer track per playing cue holding its high-pass, 4-band EQ, compressor, fades and under level, all summed into a master track with a custom lookahead limiter and meters. Streaming playback, so long songs are not loaded fully into memory. A second, separate output stream to the laptop's own jack for headphone preview, never through the master
- **Command layer:** every action (GO, stop, under, release, swap, duck, import, save…) is one Rust command. Buttons, menus, shortcuts and a future remote all call the same commands
- **Sidecars:** yt-dlp.exe and ffmpeg.exe bundled with the app; loudness via the ebur128 crate
- **Windows audio:** the windows crate's Core Audio API to find the webview's audio session and fade its volume
- **Builds:** the portable zip is the main build: one folder that runs without installing or admin rights, with settings and the WebView2 profile (background sign-ins) stored next to the exe. Copy it to the laptop's disk rather than playing from a USB stick, since a slow stick can stutter. An installer (NSIS) comes out of the same code as an extra
- **License:** own code, written from scratch; LivePlay (AGPL) used as a reference for ideas only, no code copied

## Cue list and project

A show is one ordered cue list, split into named sections, saved as a project folder that holds the show file and all its media.

**Cues**

| Field | What it does |
| --- | --- |
| Number | Auto-numbered (1, 2, 3…); editable, decimals allowed (2.5) for cues added later |
| Name | Defaults to the file or YouTube title |
| Notes | Three fields, Sound, Light (LX) and Stage, each with its own colour; shown big in Run for the current cue and the next ones ("wait for the bow", "klas 3A enters") |
| Colour | Optional tag colour, shown on the row |
| File | The audio file inside the project's media folder |
| Duration | Read from the file; shown after trim |
| Pre-wait | Seconds between GO and the cue starting |
| On end | See Timing per cue below |
| Duck background | Whether GO on this cue ducks the background player (default on) |
| Under level | The level in dB the cue drops to on U (default −12 dB), for talking over a song |
| Fade & GO | Off, 2 s or 4 s: GO on this cue fades out whatever is still playing while it starts |
| Vamp | A loop region (A–B) that repeats until Release (V), then the song plays on |
| Markers | Named points in the song ("refrein", "applause") with a countdown in Run; rehearsal can start from them |
| Attached to | A parent cue and a time (cue 1.1 at 0:05 in cue 1): it fires by itself, skips the GO queue and stops with its parent |
| Swapped | Set by an emergency swap; shows a badge and keeps the original file so the swap can be undone |

**Timing per cue:** a play count (1 to 5 times, or loop until stopped) and what happens next: nothing (wait for GO), start the next cue when this one ends, or start the next cue a set time after this one starts while it keeps playing. Example: cue 1 starts cue 1.5 after 10 s, and 1.5 plays 3 times then stops.

**Sections:** a section is a header row that groups cues ("Opening", "Klas 1", "Pause", "Finale"). Sections fold open and closed in Build and form the section rail in Run.

**Reordering:** drag and drop rows and whole sections, plus Move up / Move down in the Edit menu. Multi-select with Shift and Ctrl for move, delete and bulk edits (for example setting the same fade on 10 cues).

**Project folder**

- Schoolfeest 2027.cueplay (JSON) plus a media/ folder; imported files are copied into media/, so the folder is the whole show and can be copied to a USB stick
- Auto-save every 30 seconds while in Build; in Run only the show state (playhead, running cues and positions) is saved, every second
- Rolling backups in backups/ (last 20 saves)
- On open, missing files are listed with a Locate button; Run can't be entered until they are found or removed

**Show file:** File › Save writes a `.cueplay` file (JSON: cues, sections, pads, settings, notes, relative file paths). Save as picks the name and folder and can copy all media into `media\` next to it.

**Files per cue:** the list shows each cue's file as a name or a full path (setting). A folder watcher reloads files that change on disk; for anything it misses, each cue has Reload from disk, Replace… (keeps all settings) and Show in folder. Missing files are marked red with a Locate… button, and GO skips them with a warning.

**Sections as accordions:** click a section header to fold it; Collapse all and Expand all in the toolbar. The standing-by cue stays visible inside a folded section.

**Colours:** five preset colours plus a custom RGB colour picker, per cue and per pad.

**Print:** File › Print cue sheet makes an A4 or A3 sheet with section headers, a tick box, cue number, name, notes, length (with repeats), approximate start time and the follow action.

## Audio per cue

Every cue gets its own small processing chain, and every cue lands at the same loudness without a short loud moment pushing the rest of the track down or into clipping.

**Per-cue chain (in this order)**

- **Trim:** in-point and out-point, dragged on the waveform in the cue editor
- **Gain:** manual offset in dB on top of the normalisation gain, plus the under level used by U
- **High-pass filter:** off / 60 / 80 / 120 Hz, for boomy rips
- **EQ:** 4 bands (low shelf, two peaks, high shelf), ±12 dB, each band switchable, with a live curve you can drag; presets Flat, Clear up a rip, Less boomy, Less harsh, Dance punch, Voice
- **Compressor:** off by default; presets Light / Medium / Firm plus threshold, ratio, attack, release and make-up, with a transfer curve and a gain-reduction meter
- **Fades:** fade in, fade out before the out-point, and a stop fade used when the operator stops the cue, each with a curve (linear, S-curve, exponential); fade lengths are dragged on the waveform and the curve is drawn on it
- **Pan:** left/right balance
- Every stage can be bypassed from the chain strip in the inspector (Source → High-pass → EQ → Compressor → Fades → Duck)

Reverb and delay are left out on purpose.

**Loudness normalisation**

On import, the app measures each file once and stores the result on the cue; nothing is analysed during the show.

- Measures integrated loudness (EBU R128, in LUFS) and true peak (dBTP)
- Integrated loudness is gated and averaged over the whole track, so a few seconds of a loud chorus barely move it, and silence and quiet intros are ignored
- Gain to reach the target = target − measured loudness, default target −14 LUFS (the level Spotify normalises to, so cues and background music sit at the same loudness), set per project
- **Peak cap:** the gain is limited so the boosted true peak stays under −1 dBTP. This is the case that matters for quiet tracks with one loud hit: without the cap, raising the track would push that hit past 0 dBFS
- When the cap kicks in, the cue shows a small badge ("+4.2 dB, peak-limited") so the operator knows it will sound a bit quieter than the rest, and can raise it by hand and let the master limiter catch the hit
- The analysis also stores the loudness range (LRA); a cue with an unusually wide range gets a hint to add the compressor

**Master**

- Master fader with a stereo meter (peak + loudness)
- Brickwall peak limiter at the very end, ceiling −1 dBTP, short lookahead; always on, with a gain-reduction meter so you can see when it works
- The limiter is a safety net for overlapping cues and peak-capped tracks, not a loudness tool

## Build, Preflight and Run

The app is three steps: Build (edit the show), Preflight (check the rig) and Run (play it), switched with Ctrl+1 / Ctrl+2 / Ctrl+3. Run is locked against editing and designed for a dark booth.

**Build**

- Three panes: media bin (Used / Unused / Problems filter), cue list, inspector with a bypassable signal chain (Source → High-pass → EQ → Compressor → Fades → Duck)
- Double-click a cue for the full cue editor: waveform with trim, fades, vamp loop, song markers and attached cues; 4-band EQ with live curve; compressor with transfer curve, presets and gain-reduction meter; output level and under level
- **Attached cues:** a cue can hang on a moment inside another cue (cue 1.1 at 0:05 in cue 1). It fires by itself, skips the GO queue and stops with its parent
- Three note fields per cue: Sound, Light (LX) and Stage, each with its own colour

**Preflight**

- Automatic checks: Qu-24 found, all files present, loudness analysed at −14 LUFS, background signed in, laptop kept awake
- Your checks: mains power, desk channel up, and **desk calibration**: pink noise at −14 LUFS so the Qu-24 USB gain is set once and every show starts at the same level
- **Failure drills:** simulate a USB dropout or a crash before the audience arrives

**Run**

- **Section rail:** the show as sections; only the current section opens into cues, so it stays readable with 100+ cues. Shows time done, time left, estimated end and the gap with the plan
- Now-playing card: remaining time, next song marker ("refrein in 0:08"), Sound / Light / Stage notes, and what will fire by itself
- **Fade & GO:** per cue, GO fades out whatever is playing over 2 or 4 s while it starts
- **Under / back up (U):** drops the running cue to its own under level while someone talks, and brings it back with a fade
- **Vamp:** a loop region repeats until Release is pressed, then the song plays on
- Scrollable up-next list with search, LX notes, headphone preview, Swap and Make next (with confirm)
- **Headphone preview** on the laptop jack: check a cue or a swapped file without the hall hearing it
- **Emergency swap:** replace a cue's audio from the bin or a YouTube link; level-matched, settings kept, marked as swapped
- One dock beside GO with Pads, Background and Log tabs; the log records every GO, auto-fire, skip, swap and panic
- Master meters with peak hold, clip light, short-term loudness and limiter gain reduction

**Run layout:** Run always fits one screen. Left: the section rail. Middle: the now-playing card (the biggest thing on screen) with up next below it. Right: GO, with Stop all and Panic directly beside it, and the dock under them. Only up next and the dock's contents scroll. A show progress bar (cues done, time done, time left, estimated end) runs under the top bar in all three steps. In Run there is no drag, delete or edit; going back to Build means holding the Build button or pressing Ctrl+1 twice.

**Rehearsal mode:** start any cue from the top or from a marker, nothing is logged, and the real timings replace the plan.

**Resilience:** the show state is saved every second; after a crash the app offers to resume the cue at its exact position. If the USB connection drops, it plays on the laptop output and switches back when the Qu-24 returns.

**Booth:** theme Auto (light in Build, OLED black in Run), OLED or Light; brightness dimmer; red night mode; Big mode (GO, now, next only); GO is the laptop's spacebar, no external device.

**Make next and Skip to (**open mic and last-minute changes)

- Up next in Run lists every remaining cue, grouped by section, with length and notes; it scrolls and has search (Ctrl+K)
- Each cue has Make next. It always asks for confirmation, naming the cue and how many cues it jumps over
- Confirming moves the chosen cue in front of the standing-by cue; everything else keeps its order behind it. Undo with Ctrl+Z
- The same dialog offers Skip to it instead: move the playhead without reordering

**Stop all vs Panic:** Stop all fades every cue and pad out over the stop-all time (2 s); it is the normal way to end things. Panic cuts everything instantly with no fade and also cancels pre-waits and pending follow triggers; it is for emergencies such as feedback or a wrong cue at full level. Neither touches the background music.

**Pads (soundboard):** edited in a Pads tab next to the cue list in Build and played from the Pads tab of the Run dock. Pads are imported from files or YouTube like cues, and each has its own name, hotkey (1–9, 0), colour, mode (one-shot, toggle, loop), fades, ducking, high-pass, EQ and compressor. Pads play through the same engine and master limiter, so Stop all and Panic stop them too, and every pad press is logged.

**Timecodes**

- Every playing cue shows elapsed and remaining as `mm:ss.t` (tenths), remaining being the bigger number
- Show clock (time since the first GO) and the wall clock in the top bar
- Durations in the list are always after trim

**Playhead and GO**

- One playhead: the standing-by cue. GO fires it and moves the playhead to the next cue
- Clicking a cue in Run selects it for preview, swap or notes; it never moves the playhead (Make next and Skip to do)
- Attached cues, follow triggers and auto-continue cues fire by themselves; pre-waits and pending triggers show a countdown
- Double-press protection: a second GO within 300 ms is ignored, so a doubled spacebar press never skips a cue (setting)

**Stops**

- Stop selected cue: fades with that cue's stop fade
- Stop all: fades every cue over the project's stop-all time (default 2 s)
- Panic: hard stop, no fade (Esc pressed twice)

## Menus and shortcuts

Every menu item and shortcut calls the same command the buttons use, so the keyboard, menus and (later) a remote all behave identically. Shortcuts are rebindable in Settings. Keys marked Run only work in Run, so a stray key in Build never fires audio.

| Menu | Command | Default shortcut |
| --- | --- | --- |
| File | New show / Open / Save / Save as | Ctrl+N / Ctrl+O / Ctrl+S / Ctrl+Shift+S |
| File | Print cue sheet / Export show as zip (folder + media) | Ctrl+P / — |
| Edit | Undo / Redo | Ctrl+Z / Ctrl+Y |
| Edit | Cut / Copy / Paste / Duplicate cue | Ctrl+X / Ctrl+C / Ctrl+V / Ctrl+D |
| Edit | Delete cue | Del |
| Edit | New section | Ctrl+Shift+N |
| Edit | Move up / Move down | Alt+↑ / Alt+↓ |
| Edit | Open cue editor | Double-click, or Enter in Build |
| Edit | Find cue | Ctrl+K |
| Edit | Import audio files / Import from YouTube | Ctrl+I / Ctrl+Shift+Y |
| Edit | Renumber all cues / Re-analyse loudness of selected | — |
| View | Build / Preflight / Run | Ctrl+1 / Ctrl+2 / Ctrl+3 |
| View | Cycle theme (Auto, OLED, Light) / Red mode / Big mode | Ctrl+T / Ctrl+Shift+R / Ctrl+B |
| Playback | GO (Run) | Space or Enter |
| Playback | Previous / Next cue in up next (selection) | ↑ / ↓ |
| Playback | Stop selected | S |
| Playback | Stop all (fade) | Esc |
| Playback | Panic (hard stop) | Esc Esc |
| Playback | Under / back up | U |
| Playback | Release vamp | V |
| Playback | Headphone preview of selected cue | H |
| Playback | Pause / resume all | P |
| Playback | Pads (Run) | 1–9, 0 |
| Background | Duck / Restore / Play-pause / Next track | D / R / Shift+D / Shift+→ |
| Background | Duck / Restore instantly, no fade | Alt+D / Alt+R |

## Import

Audio comes in three ways: drag-and-drop files, a single YouTube link or playlist, or a pasted list of songs. Each item is copied into the project's media folder, analysed for loudness and added as a cue.

**Files:** drag onto the list or use Ctrl+I. Accepts MP3, WAV, FLAC, M4A/AAC, OGG/Opus. Files dropped between two cues land there.

**YouTube** (bundled `yt-dlp` + `ffmpeg`)

- Paste a video link → one cue; paste a playlist link → one cue per video, in playlist order, optionally in a new section named after the playlist
- **List import:** paste lines, one per cue, mixing links and plain "artist – title" text; text lines are searched and the top result is taken
- A preview table before downloading: title found, duration, channel, a checkbox per row, and a "replace" field per row when the search picked the wrong video
- Output format, set in Settings:
  - Original (default): keeps YouTube's audio stream (Opus or AAC), best quality, no re-encoding
  - MP3 320 kbps: for compatibility; larger, not better quality
  - WAV: for editing elsewhere
- Downloads run in a queue with progress per item; a failed item stays in the list with the reason and a retry button
- Settings → Update yt-dlp, because YouTube changes regularly break older versions

YouTube's terms don't allow downloading, and the school's music license covers playing music, not the source of the file. The app doesn't hide this, and it remains the user's call.

## Background music player

A built-in browser pane logs into Spotify, YouTube Music, Beatport or Soundtrack (each with a level offset, since Beatport plays loud club masters) and plays the background music; the app controls its volume through Windows, so show cues and background never overlap.

**How it works**

- A second WebView2 window inside the app with one tab per source; sign-ins persist between sessions
- Sources and level offsets (applied through the session volume, editable): Spotify 0 dB (normalises to −14 LUFS), YouTube Music 0 dB (about −14 LUFS), Soundtrack 0 dB, Beatport −6 dB (club masters, not normalised)
- Its sound comes from the webview process, not from the audio engine. The Rust side fades that process's volume in the Windows mixer (its audio session), which works for any site and doesn't depend on the page's code
- Play and pause go through the page (a small injected script, or the media keys the page responds to); volume always goes through Windows
- Its output device is set to the same device as the show (the Qu-24 USB), so both come in on the same desk channel

**Commands** (buttons, menu and shortcuts, all through the command layer)

| Command | Behaviour |
| --- | --- |
| Duck | Fade background down to the duck level (default −30 dB, i.e. almost silent) over the duck time (default 1.5 s) |
| Restore | Fade background back up to its set level over the restore time (default 3 s) |
| On | Start playback and fade in from silence |
| Off | Fade out, then pause |
| Duck / Restore / On / Off instantly | The same with Alt held (Alt+D, Alt+R), no fade |

**Now playing and track choice**

- The app shows the background's current track (title, artist, position, length), read from the web player's media session metadata through the injected script
- Play / pause, previous and next track; play and pause fade through the Windows session volume
- In Build, the Background button opens the full player to pick a source, sign in and choose a playlist. In Run, the Background tab of the dock shows now playing, the level, Duck / Restore / Play-pause and the track list; tapping a track tells the page to play it

**Kept apart from the show:** in Run the background lives in the Background tab of the dock, with its own colour and border. It is locked by default in Run (setting) and unlocks with a hold. Auto-ducking keeps working while it is locked, and Stop all and Panic never touch it.

**Automatic ducking**

- GO on a cue with "Duck background" on → Duck
- When the last such cue stops or ends → Restore, after a short hold (default 2 s) so a quick next cue doesn't make it pump up and down
- A manual Duck/Restore overrides the automatic one until the next GO

**Check first:** all four web players need Widevine DRM in WebView2. Spotify reportedly works; YouTube Music, Beatport's streaming player and Soundtrack get the same test in milestone 0 before the pane is built. A source that fails is dropped from the pane or, for Spotify and Soundtrack, controlled as a desktop app the same way (see Open questions).

## Output and settings

The app plays to one output device in stereo at 48 kHz; everything else is the mixer's job.

**Output**

- One show output picker, remembered per machine by device name (Qu-24 USB by default when present)
- Headphone preview: the laptop's own output (jack or built-in), only for preview and swaps; it never reaches the hall
- Stereo, 48 kHz to match the desk; files at other rates are resampled
- If the show device disappears mid-show: a red banner, playback continues on the laptop output, and the app switches back when the Qu-24 returns (practised as a Preflight drill)
- Calibration tone: pink noise at −14 LUFS, to set the Qu-24 USB channel gain once so every show starts at the same level; plus a −20 dBFS line-check tone

**Settings, per project** (saved in the show file)

- Loudness target (default −14 LUFS) and peak ceiling (−1 dBTP)
- Stop-all fade time, Fade & GO times (2 / 4 s), default fade curves, default under level
- Duck level, duck time, restore time, restore hold; background source level offsets
- GO double-press protection on/off

**Settings, per machine**

- Show output device and headphone preview device
- Keyboard shortcuts
- YouTube output format, yt-dlp version and update
- Theme (one cycle button: Auto, OLED black, Light; Auto is light in Build and OLED in Run), file display (name or full path), background lock in Run, UI size (for small laptop screens)
- Booth: brightness dimmer, red night mode, Big mode
- Language: English and Dutch

## Reliability

The rule for every decision: nothing the operator or the UI does may cause a gap, click or delay in the audio.

**Requirements**

- GO starts audio within 20 ms: the first seconds of the standing-by cue, the next two and any attached cues are pre-read into memory
- The audio engine runs in the Rust process on its own thread; a frozen or reloading UI never stops playback
- Saving, importing, YouTube downloads and loudness analysis run on background threads and never block the audio thread
- Run refuses to open while any cue has a missing file or an analysis still running; Preflight says which
- The app never auto-updates or shows a dialog by itself while in Run
- Crash recovery: the show state is saved every second; on restart the app offers to resume at the exact cue and position

**Before every real show (in Preflight**)

- Preflight's automatic checks all green and the manual ones ticked, desk calibrated with the −14 LUFS tone
- Run the full show once with the real output, in rehearsal mode so the real timings replace the plan
- Two cues overlapping at full level: the limiter catches it, no clipping on the desk
- Failure drills: a USB dropout and a crash, both mid-cue
- Background player: sign in, play, duck, restore, lock
- Leave the app 2 hours in Run with background running (laptop on mains, sleep disabled)

**Automated tests:** fade curves, loudness and peak-cap maths, command layer (GO, playhead, auto-continue, attached cues, vamp release, under, Make next, ducking rules), project load/save round trip.

## Milestones and open questions

v1 is about 12 weekends of AI-assisted work (up from 8, for the cue editor, Run's engineer features and Preflight), in an order where each step ends in something you can actually play.

| # | Milestone | Done when | Effort |
| --- | --- | --- | --- |
| 0 | Spikes | Spotify, YouTube Music, Beatport and Soundtrack log in and play in a bare Tauri WebView2; kira plays to the Qu-24 over USB and a second stream to the laptop jack; the webview's audio session can be found and faded | 1 evening |
| 1 | Engine + cue list | Import a file, cues in sections, GO / stop with fades and trim, save and reopen a .cueplay | 2 weekends |
| 2 | Audio chain + loudness | High-pass, 4-band EQ with presets, compressor per cue; R128 analysis at −14 LUFS with peak cap; master limiter and meters | 1 weekend |
| 3 | Cue editor | Waveform with drag handles for trim, fades, vamp, markers and attached cues; EQ and compressor curves; headphone preview | 2 weekends |
| 4 | Run | Section rail, now-playing card, up next with Make next, dock (Pads / Background / Log), Fade & GO, Under, Vamp release, emergency swap, all menus and shortcuts, undo/redo, print | 2 weekends |
| 5 | Import | YouTube link, playlist and list import with preview table, download queue, yt-dlp update | 1 weekend |
| 6 | Background player | Four sources with level offsets, now playing, duck / restore / play-pause with and without fades, auto-duck on GO, lock | 1 weekend |
| 7 | Preflight + booth | Automatic and manual checks, calibration tone, failure drills, rehearsal mode, themes, dimmer, red mode, Big mode | 1 weekend |
| 8 | Show-proofing | Portable build and installer, crash resume, USB dropout handling, a full dry run on the real rig | 2 weekends |

**Open questions**

- Which background sources play in WebView2 inside Tauri (Widevine)? Tested in milestone 0. Any that don't: control the desktop app instead (Spotify, Soundtrack) through the Windows session volume and media keys, or leave that source out

**Decided:**

- Name: RG CuePlay, in line with RG Coaching. The RG prefix sets it apart from the existing iOS app "CuePlay"; always write the full name in the repo, window title and exe (RG-CuePlay.exe)
- Portable build first; the installer is an extra from the same code
- GO is the laptop's spacebar, no external device. In Run, Space always means GO, even when a button has focus; the search box (Ctrl+K) is the only place Space types, and while it is open Esc closes the search instead of stopping everything
