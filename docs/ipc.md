# UI ↔ core contract (Tauri commands and events)

The UI owns the show document while editing (undo/redo lives in the UI store).
After every change it sends the whole show to the engine with `engine_set_show`.
The engine owns playback and reports state ~30 times a second.

All payload field names are camelCase. Types: see `src/types.ts` (mirrors `crates/engine/src/show.rs`
and `crates/engine/src/player.rs`).

## Commands (`invoke(name, args)`)

| Command | Args | Returns | Notes |
| --- | --- | --- | --- |
| `engine_set_show` | `{ show: Show, baseDir: string \| null }` | `void` | baseDir = folder of the .cueplay file, null for an unsaved show |
| `engine_go` | – | `"fired" \| "ignored" \| "endOfShow"` | Space / Enter in Run |
| `engine_stop_all` | – | `void` | Esc |
| `engine_panic` | – | `void` | Esc Esc |
| `engine_stop_cue` | `{ cueId: string }` | `void` | S |
| `engine_toggle_under` | `{ cueId: string \| null }` | `void` | U; null = most recent running cue |
| `engine_release_vamp` | `{ cueId: string \| null }` | `void` | V |
| `engine_set_playhead` | `{ cueId: string \| null }` | `void` | Skip to / click in Build |
| `audio_list_outputs` | – | `OutputDevice[]` (`{ name: string, isDefault: boolean }`, default first) | for the output picker |
| `audio_set_output` | `{ name: string \| null }` | `void` | part of the device name (case-insensitive), null = Windows default; saved per machine (`settings.json` in dataDir, default "Qu-24"); rebuilds the engine, so it cuts running sound (not in Run). Result comes as `engine://output` |
| `audio_output_status` | – | `OutputStatus \| null` | the last `engine://output` payload, for a UI that subscribed late; null before the engine first started |
| `show_open` | `{ path: string }` | `Show` | |
| `show_save` | `{ path: string, show: Show }` | `Show` | returns the show with file paths rewritten to `media/…`; UI must adopt it |
| `analyze_file` | `{ baseDir: string \| null, file: string }` | `Analysis` | slow (decodes the file); runs off the UI thread; cached per path |
| `app_info` | – | `{ version: string, portable: boolean, dataDir: string }` | |

File pickers use `@tauri-apps/plugin-dialog` (`open`, `save`) from the UI.
Audio file filter: mp3, wav, flac, m4a, aac, ogg, opus. Show filter: cueplay.

## Events (`listen(name, cb)`)

| Event | Payload | Rate |
| --- | --- | --- |
| `engine://state` | `EngineState` | ~30 Hz, always (also when idle, so meters fall back) |
| `engine://output` | `OutputStatus` = `{ outputName: string, outputFound: boolean, preferred: string \| null }` | on start and whenever the output changes. `outputFound: false` = preferred device missing, playing on the Windows default; the core looks again every 2 s while nothing plays and switches over by itself |
| `engine://error` | `string` | when the audio device fails or a command errors |

## Engine extras

| Command | Args | Returns | Notes |
| --- | --- | --- | --- |
| `engine_pad` | `{ padId: string }` | `void` | Pad press (keys 1–9, 0 in Run). Toggle/loop pads stop on a second press |
| `engine_go_from` | `{ cueId: string, at: number }` | `void` | Rehearsal: start a cue at `at` seconds into its file (a marker). Moves the playhead past it |
| `engine_tone` | `{ kind: "pink" \| "line" \| null }` | `void` | Preflight calibration: pink noise at the show's `targetLufs`, or 1 kHz at −20 dBFS. null = stop. Stop all also stops it |

## Headphone preview (second output, never through the show master)

A second engine on its own thread and device. It shares nothing with the show engine.

| Command | Args | Returns | Notes |
| --- | --- | --- | --- |
| `audio_set_preview_output` | `{ name: string \| null }` | `void` | part of the device name; null = Windows default device. Saved per machine (`previewDevice` in `settings.json`) |
| `preview_play` | `{ cue: Cue, baseDir: string \| null, at: number }` | `void` | Plays one cue (or a pad's cue, or a swap candidate) from `at` s into its file. Replaces any running preview. Errors if the file can't be opened or there is no preview output |
| `preview_stop` | – | `void` | |

Event `preview://state` → `PreviewState = { playing: boolean, name: string \| null, position: number, length: number, outputName: string, sameAsShow: boolean }`
(~10 Hz while playing, once when it stops, once when the preview output is (re)opened).
`sameAsShow: true` = the preview device is also the show output: warn "preview would go to the hall!".

## Crash resume

| Command | Args | Returns | Notes |
| --- | --- | --- | --- |
| `app_session` | `{ showPath: string \| null, mode: "build" \| "preflight" \| "run" }` | `void` | UI calls this on open/save/mode change, so the resume file knows the show. An unsaved show (null) is never written |
| `engine_resume` | `{ items: { cueId: string, position: number }[] }` | `void` | Restarts those cues at those file positions (no fade-in), standalone (no follow). Each start or skip is written to the show log (kind `resume` / `skip`). Pad cues are found too |
| `app_resume_info` | – | `ResumeInfo \| null` | Present only when the previous session ended without a clean exit while in Run |
| `app_resume_dismiss` | – | `void` | |

`ResumeInfo = { showPath: string, playhead: string | null, running: { cueId: string, name: string, position: number }[], savedAtMs: number }`.
The shell writes `resume.json` to the data dir every second while in Run (when something plays or the playhead
moved), deletes it when leaving Run, and deletes it on clean exit. `position` is the position in the file (trim included),
so `running` can be passed to `engine_resume` as is. Suggested UI flow: `app_resume_info` → open the show →
`engine_set_show` → `engine_set_playhead(playhead)` → `engine_resume(running)`.

## USB dropout (no commands)

When the show device disappears mid-show, sound moves to the Windows default output (kira does this itself and
running cues keep their place). The core logs it (kind `output`), emits `engine://error` with a readable text and
`engine://output` with `outputFound: false`. If the running cues have not moved on 1.5 s later, the core rebuilds
on the default output and restarts them at their last positions (log kind `rescue`). When the preferred device is back
and nothing plays (no cue, no tone), it switches back (log kind `output`).

## YouTube import (yt-dlp, ffmpeg) and conversion

Binaries live in `<dataDir>/bin/`. Nothing is bundled: Settings › Install / Update downloads them from GitHub.
ffmpeg (ffmpeg.exe + ffprobe.exe from the BtbN build) is needed for MP3/WAV, for "Original" when a video has no
M4A stream, and for `media_convert`.

| Command | Args | Returns | Notes |
| --- | --- | --- | --- |
| `yt_status` | – | `{ ytDlp: string \| null, ffmpeg: boolean, binDir: string }` | ytDlp = version or null when missing |
| `yt_install` | `{ what: "ytDlp" \| "ffmpeg" }` | `void` (resolves when finished) | progress via `yt://install` `{ what, percent, done, error? }`; `done: true` once, with `error` on failure |
| `yt_resolve` | `{ lines: string[] }` | `YtItem[]` | each line: a video link, a playlist link (expands to all videos) or plain "artist – title" text (top search result). A failed line gives one item with `error` set (id `error:<line>`). Duplicate videos get ids `<id>#2`, … |
| `yt_download` | `{ items: { id: string, url: string, title: string }[], format: "original" \| "mp3" \| "wav", destDir: string }` | `void` | queue, 2 at a time; progress via `yt://progress`. Original = YouTube's M4A stream as is; Opus-only videos are converted to M4A (AAC 256k) with ffmpeg, or fail with "needs ffmpeg — install it in Settings" |
| `media_convert` | `{ path: string, destDir: string }` | `string` (new path) | converts a file the engine can't decode (.opus, .webm, …) to `<destDir>/<name>.m4a` (AAC 256k, no video); never overwrites (`name (2).m4a`). Error if ffmpeg is missing |

`YtItem = { id: string, input: string, url: string, title: string, channel: string, duration: number, playlist: string | null, error: string | null }`
`yt://progress` → `{ id: string, percent: number, status: "queued" | "downloading" | "converting" | "done" | "error", file: string | null, error: string | null }`.
`destDir`: the show's `media/` folder when the show is saved, else `<dataDir>/downloads`.

Note: the engine (symphonia) does not decode Opus/WebM. When the user adds such a file, call `media_convert` first.
