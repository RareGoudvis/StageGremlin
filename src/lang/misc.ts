// Texts for: Everything else: top bar, overlays, toasts, file actions, print sheet.
// Keys start with the area's prefix. `en` is the full list; `nl` may leave keys out (they fall back to English).

export const en = {
  // top bar: output chip, master fader, booth menu, output banner
  "m.top.playingOn": "Playing on {name}", "m.top.waitEngine": "Waiting for the engine", "m.top.clickOutput": "click to choose the output",
  "m.top.outputMissing": "OUTPUT MISSING", "m.top.noEngine": "NO ENGINE",
  "m.master.title": "Master level (double-click: 0 dB)", "m.master.aria": "Master level", "m.master.label": "Master",
  "m.booth.aria": "Booth settings", "m.booth.brightness": "Brightness · {n}%",
  "m.booth.redOn": "Red night mode on · Ctrl+Shift+R", "m.booth.redOff": "Red night mode off · Ctrl+Shift+R",
  "m.booth.bigOn": "Big mode on · Ctrl+B", "m.booth.bigOff": "Big mode off · Ctrl+B",
  "m.booth.dumbo": "Turn on Dumbo mode",
  "m.booth.hint": "Big mode shows only GO, what's playing and what's next (in Run). Ctrl+T cycles the theme.",
  "m.out.lost": "{name} not found — playing on {now}", "m.out.chosen": "The chosen output",
  // file menu, progress bar, meter, mode switch
  "m.file.nameAria": "Show name",
  "m.progress.aria": "Show progress",
  "m.meter.aria": "Master meter", "m.meter.lufs": "Short-term loudness (last 3 s), LUFS", "m.meter.gr": "Limiter gain reduction",
  "m.mode.aria": "Workflow", "m.mode.hold": "Hold to leave Run",
  "m.mode.pressAgain": "Press {key} again to leave Run",
  "m.mode.holdToLeave": "Hold {mode} for a second (or press {key} twice) to leave Run",
  // tools (yt-dlp, ffmpeg)
  "m.tool.missing": "{tool} is not installed.", "m.tool.install": "Install {tool}",
  "m.tool.failed": "Installing {tool} failed: {e}", "m.tool.installed": "{tool} installed",
  // window title, settings file
  "m.untitled": "Untitled", "m.settingsFile": "StageGremlin settings",
} as const;

export const nl: Partial<Record<keyof typeof en, string>> = {
  "m.top.playingOn": "Speelt op {name}", "m.top.waitEngine": "Wachten op de engine", "m.top.clickOutput": "klik om de uitgang te kiezen",
  "m.top.outputMissing": "UITGANG WEG", "m.top.noEngine": "GEEN ENGINE",
  "m.master.title": "Hoofdniveau (dubbelklik: 0 dB)", "m.master.aria": "Hoofdniveau", "m.master.label": "Master",
  "m.booth.aria": "Regie-instellingen", "m.booth.brightness": "Helderheid · {n}%",
  "m.booth.redOn": "Rode nachtmodus aan · Ctrl+Shift+R", "m.booth.redOff": "Rode nachtmodus uit · Ctrl+Shift+R",
  "m.booth.bigOn": "Grote modus aan · Ctrl+B", "m.booth.bigOff": "Grote modus uit · Ctrl+B",
  "m.booth.dumbo": "Dumbo-modus aanzetten",
  "m.booth.hint": "Grote modus toont alleen GO, wat speelt en wat volgt (in SHOW). Ctrl+T wisselt het thema.",
  "m.out.lost": "{name} niet gevonden — speelt op {now}", "m.out.chosen": "De gekozen uitgang",
  "m.file.nameAria": "Naam van de show",
  "m.progress.aria": "Voortgang van de show",
  "m.meter.aria": "Hoofdmeter", "m.meter.lufs": "Luidheid op korte termijn (laatste 3 s), LUFS", "m.meter.gr": "Gainreductie van de limiter",
  "m.mode.aria": "Werkwijze", "m.mode.hold": "Ingedrukt houden om SHOW te verlaten",
  "m.mode.pressAgain": "Druk nog eens {key} om SHOW te verlaten",
  "m.mode.holdToLeave": "Hou {mode} een seconde ingedrukt (of druk twee keer {key}) om SHOW te verlaten",
  "m.tool.missing": "{tool} is niet geïnstalleerd.", "m.tool.install": "{tool} installeren",
  "m.tool.failed": "{tool} installeren mislukt: {e}", "m.tool.installed": "{tool} geïnstalleerd",
  "m.untitled": "Naamloos", "m.settingsFile": "StageGremlin-instellingen",
};
