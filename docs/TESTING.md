# StageGremlin: test plan for the first evening on Windows

Work from top to bottom. The most important things come first, so if you run out of time, stop anywhere.
Each step says what **good** looks like. If something isn't good, take a screenshot, jot down the step
number and move on (see "What to send back" at the end).

Have ready: 4–6 local audio files (at least one MP3, one M4A, one WAV, one loud song and one quiet one),
headphones, and a USB audio device if you have one at home (a USB headset or USB sound card works).

---

## 0. Build it

1. Install **Rust**: <https://rustup.rs> → run `rustup-init.exe` → accept the defaults.
   If it says Visual Studio C++ build tools are missing, let it install them, or do step 2.
2. Install **Visual Studio Build Tools 2022**: <https://visualstudio.microsoft.com/visual-cpp-build-tools/>
   → tick **"Desktop development with C++"** (it includes the MSVC compiler and the Windows SDK). Restart afterwards.
3. Install **Node.js 22 LTS**: <https://nodejs.org>.
4. Open a **new** terminal (PowerShell) in the project folder and run:
   ```
   npm install
   npm run tauri dev
   ```
   **Good:** the first time, Rust compiles ~500 crates. That takes **5–15 minutes**, with lots of
   `Compiling …` lines. Then a window "StageGremlin" opens. Later starts take seconds.

**Common errors**

| You see | Fix |
| --- | --- |
| `link.exe not found` / `linker 'link.exe' not found` | Step 2 is missing or the terminal is older than the install: install "Desktop development with C++", open a new terminal |
| `cargo` / `rustc` not recognised | Close and reopen the terminal (rustup adds itself to PATH) |
| Window opens white or doesn't open; WebView2 error | Install the "Evergreen Bootstrapper" from <https://developer.microsoft.com/microsoft-edge/webview2/> (Windows 11 normally has it) |
| `npm` errors about the Node version | `node -v` must say v22.x |
| Port 1420 already in use | Another `tauri dev` is still running: close it (or close the terminal) |

---

## 1. Core playback (the most important part)

Use Build mode unless the step says Run.

1. **Import**: add your audio files to the cue list (button or drag from Explorer).
   **Good:** one cue per file, numbered, with a name. After a few seconds each gets a loudness/analysis
   badge and a waveform. A file that fails shows a readable error, not a crash.
2. **GO**: go to Run and press **Space**.
   **Good:** the first cue plays within a blink, the playhead moves to the next cue, and the timer counts down.
   Pressing Space twice very quickly fires only once (double-GO protection).
3. **Fades**: give a cue a fade-in and a fade-out and play it.
   **Good:** smooth start and end, no clicks.
4. **Stop all (Esc)**: with two cues playing, press **Esc**.
   **Good:** everything fades out over ~2 s.
5. **Panic (Esc Esc)**: with sound playing, press **Esc twice quickly**.
   **Good:** silence at once, with no loud click.
6. **Follow**: set cue 1 to "follow after end", then GO.
   **Good:** cue 2 starts by itself when cue 1 ends. Also try "after start" with a few seconds: cue 2 starts N s after cue 1.
7. **Attached cue**: attach a short cue to a moment inside a longer one.
   **Good:** it plays exactly at that moment, and stops if you stop the parent.
8. **Pre-wait**: give a cue 3 s pre-wait.
   **Good:** after GO it waits 3 s (a pending timer is visible), then plays.
9. **Play count**: set a short cue to 3 passes.
   **Good:** it plays 3 times, and the pass counter goes 1/3, 2/3, 3/3. A count of 0 loops until stopped.
10. **Vamp + V**: set a vamp loop region on a song and play it. Press **V**.
    **Good:** the loop repeats until V, then the song plays on to the end.
11. **Duck + U** (the button reads "DUCK −12 dB · U"; Dutch "ZACHTER"): while a cue plays, press **U**, then **U** again.
    **Good:** the cue drops ~12 dB with a fade, then comes back up.
12. **Exclusive cues** (Timing › "When this starts, the others…"): set a cue to Stop, then Fade out (2 s), then
    Crossfade (3 s), and fire it each time while another cue plays.
    **Good:** Stop cuts the other at once without a click; Fade out fades it over 2 s while the new one starts at full
    level; Crossfade fades the other out while the new one fades in over the same 3 s. An old show with "Fade & GO"
    opens with those cues set to Fade out, same time.
12b. **GO lock-out** (Settings › Show & regie › GO-vergrendeling = 2 s): press GO twice quickly, then wait.
    **Good:** the second press does nothing; the GO button is pale with a bar running out, then works again.
12c. **Too fast?** In Run, press GO two cues too far, unfold "Al gespeeld" above the list, and use Spring naar on the
    cue that should have played (or Maak volgende to play it once more).
    **Good:** that cue stands by again and GO plays it; with Maak volgende the show carries on after it.
12d. **Big mode (Ctrl+B) and Dumbo mode show the state**: give a cue a 5 s pre-wait, a vamp, and press P once in Run.
    **Good:** after GO on the pre-wait cue, both screens say "Start over 0:05 · <cue>" counting down (not "Er speelt
    niets"). While paused, an amber GEPAUZEERD block covers the now-playing card (Dumbo: pressing it carries on).
    While the vamp loops, a cyan LUS LOSLATEN · V button shows; it (or V) lets the song play on to its end.
13. **Save / reopen**: save the show as `test.sg` in a new folder, close the app, start it again and open it.
    **Good:** everything is back as it was. Next to the `.sg` there is a `media/` folder with copies of all
    audio files, and a `backups/` folder after the second save.
14. **Log**: look at the show log.
    **Good:** every GO, stop, panic, etc. is listed with a time.

---

## 2. Output device

1. In Settings, open the output list.
   **Good:** all your Windows outputs are listed, with the default marked. With no Qu-24 at home, the app says the
   preferred device is not found and it plays on the default output; it does **not** stop working.
2. Pick another output (e.g. your USB headset). Play a cue.
   **Good:** the sound comes out of that device.
3. **Unplug test** (optional, USB device only — not needed for the Qu-24: its USB-B plug stays put, and if the desk
   itself dies all hall sound is gone anyway): set the USB device as the output, start a long song, then **pull the USB plug**.
   **Good:** the song carries on from the laptop speakers within a second or two. A message says the output was
   lost, and the log has an "output" line (maybe a "rescue" line). The song does not restart from the beginning.
4. **Replug**: plug it back in, stop all sound and wait ~5 s.
   **Good:** the app switches back to the USB device by itself, and the log says "Back on …".
5. **Meters / limiter**: play your two loudest cues at the same time.
   **Good:** the meters move. The limiter / gain-reduction indicator lights up, and there is no harsh distortion.

---

## 3. Preview (headphones)

1. Set the preview output to your headphones (or leave it on the Windows default).
   **Good:** if preview and show output are the same device, the app warns that the preview would be heard in the hall.
2. Preview a cue while a show cue plays.
   **Good:** the preview is only on the headphones and the show output is untouched. The position and length update.
   Starting another preview replaces the first one.
3. Stop the preview.
   **Good:** it stops, and the show is not affected.

## 4. Tone

1. In Preflight, start the **pink noise** tone, then the **1 kHz line** tone, then stop it.
   **Good:** a steady noise / sine wave. Stop (or Esc / Stop all) ends it.

## 5. Pads

1. Make 2–3 pads (one-shot, toggle, loop) and press keys **1**, **2**, **3** in Run.
   **Good:** they play without moving the playhead. A toggle or loop pad stops on a second press. Stop all also stops pads.

---

## 6. YouTube import

1. Settings › YouTube › **Install yt-dlp**.
   **Good:** a progress bar, then a version number is shown.
2. **Install ffmpeg** (downloads ~150–200 MB; only `ffmpeg.exe` is kept).
   **Good:** progress up to 100 %, and ffmpeg is shown as installed.
3. Paste three lines: one video link, one **playlist** link and one plain line like `Queen – Don't Stop Me Now`.
   **Good:** the video gives 1 item, the playlist gives all its videos, and the text line gives the top search result,
   each with title, channel and duration. A bad line shows an error on that line only.
4. Download a few as **Original**, and one as **MP3**.
   **Good:** at most 2 download at once, with percentages; Original ends as `.m4a`, MP3 as `.mp3`. The files land in the
   show's `media/` folder, become cues and get analysed.
5. Optional: add an `.opus` or `.webm` file.
   **Good:** the app converts it to `.m4a` first (with ffmpeg) instead of failing.

---

## 7. Background player

1. Open the background player with **Spotify**, sign in and play a song.
   **Good:** the music plays, and title/artist appear in the dock.
2. Repeat for **YouTube Music**, **Beatport** and **Soundtrack**.
   **Good:** sign-in works and music plays. Write down any service that shows a DRM/"can't play" error.
3. **Session found**: the panel says the Windows volume session is found.
   **Good:** in the Windows Volume Mixer, the player shows up as its own entry.
4. **Duck / Restore** buttons.
   **Good:** the music fades down (~1.5 s) and back up (~3 s), and the Windows Volume Mixer slider moves along.
5. **Auto-duck**: give a cue "Duck background" and GO it while music plays.
   **Good:** the music ducks when the cue starts and comes back ~2 s after the cue ends.
6. **Stop all / Panic** while background music plays.
   **Good:** cues stop, but the background music is left alone.
7. **Hide the window** in Run.
   **Good:** the music keeps playing.
8. **Exit the app** while the music is ducked.
   **Good:** the player closes, and the next time the player's volume in the Windows Volume Mixer is back to normal (not stuck low).
9. **The app's own sound is never ducked**: in the Volume Mixer, only an `msedgewebview2` entry moves on Duck — the StageGremlin entry stays put.
10. **Track list**: open a Spotify playlist / a YouTube Music queue.
    **Good:** the tracks appear in the dock, and tapping one plays it.
11. **Keys in Run** (also while the dock is locked): D duck · R restore · Shift+D play/pause · Shift+→ next · hold Alt for no fade.
12. **Per show**: change the duck level in one show, save, open another show, come back.
    **Good:** each show keeps its own setting.
13. **Paused in the background for 5+ minutes**, then press play.
    **Good:** the controls still respond (Windows slows down hidden pages; tell me if it gets stuck).

---

## 8. Crash resume

1. Open a **saved** show, go to **Run** and GO two cues so both are playing.
2. Open **Task Manager** and end the "StageGremlin" task (in dev mode, closing the terminal also works).
3. Start the app again.
   **Good:** it offers to resume, naming the show and the cues that were playing. Resume opens the show and restarts those
   cues at about the spot where they were (within a second or two). Dismiss makes the offer go away for good.
4. Exit the app normally, then start it again.
   **Good:** no resume offer.

---

## 9. Portable build

1. Run:
   ```
   npm run tauri build
   ```
   **Good:** after a few minutes you get `target\release\StageGremlin.exe` and an installer in `target\release\bundle\nsis\`
   (note: `target` is at the **project root**, not inside `src-tauri`).
2. Make a new folder (e.g. on a USB stick), copy `StageGremlin.exe` into it and add an **empty** file `portable.txt`.
3. Start the exe from there.
   **Good:** the app runs. A `data` folder appears next to the exe (settings, WebView2 data, `bin` for yt-dlp/ffmpeg),
   and the About/settings screen says *portable*. Nothing new appears in `%APPDATA%`.

---

## What to send back

- **Screenshots** of every error or anything that looks wrong, with the step number.
- **DevTools console**: in `npm run tauri dev`, right-click in the app → **Inspect** → **Console** tab. Screenshot or copy
  the red lines.
- **Terminal output**: copy the last ~50 lines from the terminal running `npm run tauri dev`, especially lines with
  `error`, `panicked` or `warning`.
- For sound problems, a short phone video helps (what you pressed, what you heard).


---

## Review fixes (27 Oct 2026) — needs Windows / the Qu-24

These can't be tested automatically; please check them on the real laptop:

1. **Save As to another folder** (USB stick or a new folder): open the show from the new folder only, rename the
   old folder → every cue still plays. **Good:** nothing marked missing.
2. **Emergency keys through a dialog**: in Run, open *Make next* (or Swap, or right-click a cue), then press
   **Esc Esc** quickly. **Good:** Panic (everything stops instantly). A single Esc only closes the dialog.
3. **Preflight states**: open a show, go to Preflight straight away. **Good:** "Checking the files…", then
   "All cue and pad files verified". Rename one media file in Explorer → Run is blocked with the reason.
   A file that won't decode (rename a .txt to .mp3) also blocks Run.
4. **Background music routing**: set the laptop speakers as Windows default, Qu-24 as show output, play
   background music. **Good:** Preflight shows the amber "Background music goes to Speakers…" row with an
   "Open Windows sound settings" button; after making the Qu-24 default, it turns green and the music is on the desk.
5. **GO from a slow USB stick**: put the show folder on a USB stick, GO quickly through several cues.
   **Good:** no stutter, timers (pre-waits, follows) on time.
6. **Rehearsal from a marker**: a cue with an attached cue later in the song → start from a marker before it.
   **Good:** the attached cue fires at its moment; one before the marker doesn't.

## AUDAC + settings (27 Oct 2026, later) — needs the real MTX

1. **Panel usable:** connect → the zones stop being grey within a few seconds and each zone's current input lights up.
2. **Names:** Settings › AUDAC › "Names on the MTX" shows the box's own zone/input names (Gym, Podium…).
   Factory names here are replaced by them; a name you typed stays.
3. **Someone else:** with StageGremlin connected, change a zone in Touch 2. **Good:** an amber "Changed by someone else"
   line in the panel and a toast. If Touch 2 can't connect while StageGremlin is connected, write that down.
4. **Guard:** guard that zone (Always), change it again in Touch 2. **Good:** it jumps back within a second or two,
   at most 3 times a minute.
5. **Find:** with music on, press Find on a zone → that room drops out three times, briefly.
6. **Groups / Select:** a group row and "Select…" set input, volume and mute on all their zones.
7. **No Qu-24 at home:** start without it → no red banner, plays on the laptop; plug it in while idle → switches over.
8. **Settings carry over:** unzip the next build next to this one → start → toast "Settings brought over…",
   AUDAC/Streambox set up as before. Settings › About › Export… / Import… round-trips.
9. **Hold:** Guard › How hard › Hold. Change a guarded zone in Touch 2 again and again: it always comes back.
10. **Scheduled time protects:** while a scheduled time is on, turn one of its zones UP in Touch 2 → back to its
    level at once. Turn it DOWN → allowed (unless "May not change it"). Per zone levels: "Per zone" next to Level.
11. **Conversation:** Settings › AUDAC › Conversation with the MTX › Show → Copy, and send it along.

## Streambox from the school work laptop — findings (27 Oct 2026)

- Laptop on the staff network (192.168.90.x), box on 192.168.85.x. Laptop → box works (DLNA control: volume, play/stop).
- Box → laptop is blocked: Windows firewall ON, BlockInbound, LocalFirewallRules "N/A (GPO-store only)" (only IT can
  add rules), and a phone on the box's Wi-Fi can't open the stream address either. So DLNA/Cast sending can't work there.
- AirPlay push tested with cliraop (libraop): no answer on 5000/7000; a scan of ~90 usual ports found nothing open
  from the laptop. The network filters too. AirPlay route closed.
- What works there: Spotify Connect (same account in the player and on the phone, Premium), web radio/internet links
  (the box fetches them itself). Sending StageGremlin's own sound needs another network/laptop, an IT rule, or an
  internet relay (Icecast) — parked.
