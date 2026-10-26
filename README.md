# RG CuePlay

A QLab-style cue player for Windows, made for school shows: build the show at home, check the rig in
Preflight, and run it from the booth with the spacebar as GO. One stereo feed to the mixer (Qu-24 over USB).

- Spec: [`docs/brief.md`](docs/brief.md) (exported from the online brief)
- How the parts talk: [`docs/ipc.md`](docs/ipc.md)
- Notes for Claude Code: [`CLAUDE.md`](CLAUDE.md)

## First time on a Windows PC (once)

You need admin rights for these installs, so do this on your home PC, not the school laptop.

1. **Rust**: install from <https://rustup.rs> (`rustup-init.exe`, accept the defaults). When it asks for the
   *Visual Studio C++ Build Tools*, let it install them (workload "Desktop development with C++").
2. **Node.js 22 LTS** from <https://nodejs.org>.
3. **WebView2** is already part of Windows 10/11. Nothing to do.
4. Optional: **Git** (<https://git-scm.com>) if you want to put this on GitHub later.

## Run it

Unzip the project somewhere *outside* OneDrive (OneDrive and `node_modules`/`target` don't mix well), open a
terminal in the folder, then:

```
npm install
npm run tauri dev
```

The first run compiles all the Rust code, which takes a few minutes. After that it starts in seconds and the
UI reloads by itself when you change code.

## Make the portable app

```
npm run tauri build
```

This gives you `target\release\rg-cueplay.exe` (and an installer under `target\release\bundle\nsis\`).
For the portable version, put the exe in a folder together with an empty file called `portable.txt`:
settings and sign-ins are then stored next to the exe, in `data\`. Copy that folder to the show laptop.
The show laptop needs no installs and no admin rights.

## Check the engine without sound

```
cargo test -p cueplay-engine
```

Runs the playback tests (GO, follow cues, attached cues, passes, vamp, panic, save/open, loudness) on a fake
sound card.

## Keep building with Claude Code

Open this folder in Claude Code and start with something like *"Read CLAUDE.md and docs/brief.md, then
continue with the next milestone."* `CLAUDE.md` lists what's done and what's next.

## Builds on GitHub

The code lives at `RareGoudvis/StageGremlin`. Pushing to `main` builds nothing. A Windows build starts when:
- something is pushed to the `release` branch, or
- you press **Actions → Build Windows → Run workflow** on GitHub.

Download from the finished run's **Artifacts**: `RG-CuePlay-portable` (unzip, right-click the zip → Properties →
Unblock first, then run `rg-cueplay.exe`) or `RG-CuePlay-installer`. Public repo = free, unlimited builds.

## License

AGPL-3.0-or-later.
