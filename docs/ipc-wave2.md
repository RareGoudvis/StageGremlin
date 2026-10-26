# Contract, round 2 (merge into ipc.md when done)

Same rules as `ipc.md`: camelCase payloads, every action is one command, UI owns the document.

## Engine extras

| Command | Args | Returns | Notes |
| --- | --- | --- | --- |
| `engine_pad` | `{ padId: string }` | `void` | Pad press (keys 1–9, 0 in Run). Toggle/loop pads stop on a second press |
| `engine_go_from` | `{ cueId: string, at: number }` | `void` | Rehearsal: start a cue at `at` seconds into its file (a marker). Moves the playhead past it |
| `engine_tone` | `{ kind: "pink" \| "line" \| null, hz?: number }` | `void` | Preflight calibration: pink noise at the show's target LUFS, or a sine at −20 dBFS (`hz`, default 1000; 20–20 000, rounded to 0.1 Hz so the 10 s loop has no click). null = stop. Stop all also stops it |

## Headphone preview (second output, never through the show master)

| Command | Args | Returns | Notes |
| --- | --- | --- | --- |
| `audio_set_preview_output` | `{ name: string \| null }` | `void` | null = Windows default device. Remembered per machine |
| `preview_play` | `{ cue: Cue, baseDir: string \| null, at: number }` | `void` | Plays one cue (or a pad's cue, or a swap candidate) on the preview device. Replaces any running preview |
| `preview_stop` | – | `void` | |

Event `preview://state` → `{ playing: boolean, name: string \| null, position: number, length: number, outputName: string }` (~10 Hz while playing, once when it stops).

## Crash resume

| Command | Args | Returns | Notes |
| --- | --- | --- | --- |
| `app_session` | `{ showPath: string \| null, mode: "build" \| "preflight" \| "run" }` | `void` | UI calls this on open/save/mode change, so the resume file knows the show |
| `engine_resume` | `{ items: { cueId: string, position: number }[] }` | `void` | Restarts those cues at those file positions (no fade-in) |
| `app_resume_info` | – | `ResumeInfo \| null` | Present only when the previous session ended without a clean exit while in Run |
| `app_resume_dismiss` | – | `void` | |

`ResumeInfo = { showPath: string, playhead: string \| null, running: { cueId: string, name: string, position: number }[], savedAtMs: number }`.
The shell writes it to the data dir every second while in Run, and deletes it on clean exit.

## YouTube import (yt-dlp, ffmpeg)

Binaries live in `<dataDir>/bin/`. Nothing is bundled: Settings › Install / Update yt-dlp downloads
`yt-dlp.exe` from its GitHub release; ffmpeg is only needed for MP3/WAV output (Original keeps
YouTube's own audio stream and needs no ffmpeg).

| Command | Args | Returns | Notes |
| --- | --- | --- | --- |
| `yt_status` | – | `{ ytDlp: string \| null, ffmpeg: boolean, binDir: string }` | ytDlp = version or null when missing |
| `yt_install` | `{ what: "ytDlp" \| "ffmpeg" }` | `void` | progress via `yt://install` `{ what, percent, done, error? }` |
| `yt_resolve` | `{ lines: string[] }` | `YtItem[]` | each line: a video link, a playlist link (expands to all videos) or plain "artist – title" text (top search result) |
| `yt_download` | `{ items: { id: string, url: string, title: string }[], format: "original" \| "mp3" \| "wav", destDir: string }` | `void` | queue, 2 at a time; progress via `yt://progress` |

`YtItem = { id: string, input: string, url: string, title: string, channel: string, duration: number, playlist: string \| null, error: string \| null }`
`yt://progress` → `{ id: string, percent: number, status: "queued" \| "downloading" \| "converting" \| "done" \| "error", file: string \| null, error: string \| null }`.
`destDir`: the show's `media/` folder when the show is saved, else `<dataDir>/downloads`.

## Background player

| Command | Args | Returns | Notes |
| --- | --- | --- | --- |
| `bg_open` | `{ source: BgSource, show: boolean, link?: string \| null }` | `void` | creates/navigates the background window; `show` brings it to front (Build) or keeps it hidden (Run). `link`: a playlist page to open instead of the start page; only https on that service's own site (same hosts as capabilities/background.json), else an error |
| `bg_hide` | – | `void` | hides the window; playback continues |
| `bg_command` | `{ cmd: "duck" \| "restore" \| "play" \| "pause" \| "next" \| "prev", instant: boolean }` | `void` | play/pause fade through the Windows session volume unless instant |
| `bg_set_level` | `{ db: number }` | `void` | the "normal" level (0 dB = unity), before the source offset |
| `bg_set_config` | `{ config: BgConfig }` | `void` | stored per show (UI keeps it in the document under `show.background` later; for now per machine) |
| `bg_get_state` | – | `BgState` | |
| `bg_get_config` | – | `BgConfig` | the saved settings, so the Build panel can show them |
| `bg_play_track` | `{ index: number, title: string }` | `void` | plays row `index` of `BgState.tracks` (title guards against a changed list) |

`BgSource = "spotify" | "ytmusic" | "beatport" | "soundtrack" | "soundcloud" | "youtube"` (youtube = plain YouTube videos)

`bg_dock` `{ rect: { x, y, w, h } | null }`: the Background screen places the player window over its middle area (physical px inside the main window; frameless, owned by the main window); `null` makes it a normal hidden window again.
`BgConfig = { duckDb: number /* −30 */, duckTime: number /* 1.5 */, restoreTime: number /* 3 */, restoreHold: number /* 2 */, autoDuck: boolean, offsets: Record<BgSource, number> /* beatport −6 */ }`
`BgState` event `bg://state` (~4 Hz) → `{ source: BgSource \| null, open: boolean, visible: boolean, playing: boolean, title: string \| null, artist: string \| null, position: number \| null, duration: number \| null, levelDb: number, ducked: boolean, sessionFound: boolean, error: string \| null, tracks: { title: string, artist: string \| null }[] \| null }` (tracks: best effort, null = not available for this source)

Auto-duck lives in Rust: when any running cue has `duckBg` → Duck; when none is left → Restore after `restoreHold`. A manual Duck/Restore overrides it until the next GO.
