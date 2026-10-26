// A small translation table: English and Dutch (Flemish) for the main labels.
// Use `useT()` in components: const t = useT(); t("go"). Missing Dutch strings fall back to English.

import { useSettings } from "./settingsStore";

export type Lang = "en" | "nl";

const en = {
  // top bar and modes
  "mode.build": "BUILD", "mode.preflight": "PREFLIGHT", "mode.run": "RUN",
  "top.time": "Time", "top.show": "Show", "top.notSaved": "not saved yet", "top.booth": "BOOTH", "top.settings": "Settings",
  "top.left": "left",
  "top.saved": "saved", "top.unsaved": "not saved", "top.fileMenu": "Show menu: file actions", "top.background": "Background", "out.choose": "Choose output…",
  // File menu (click the show name)
  "file.new": "New show", "file.open": "Open…", "file.recent": "Open recent", "file.noRecent": "No recent shows",
  "file.save": "Save", "file.saveAs": "Save as…", "file.exportZip": "Export show as zip…", "file.print": "Print cue sheet…",
  "file.settings": "Settings…", "file.rename": "Rename show…",
  // run
  go: "GO", stopAll: "STOP ALL", panic: "PANIC", "run.nowPlaying": "Now playing", "run.silence": "Silence · GO plays",
  "run.upNext": "Up next", "run.standby": "Standby", "run.then": "Then", "run.skipTo": "Skip to", "run.makeNext": "Make next",
  "run.sections": "Sections", "run.endOfShow": "End of show",
  // Build: rail, toolbar, View menu, selection bar, media view
  "build.undo": "Undo", "build.redo": "Redo",
  "rail.cues": "Cues", "rail.pads": "Pads", "rail.media": "Media",
  "build.add": "Add", "build.find": "Find a cue…", "build.view": "View",
  "build.tip": "Tip: right-click a cue or section for everything else. Ctrl/Shift-click selects several.",
  "build.noMatch": "No cue matches", "build.emptySection": "Empty section. Drag cues here, or right-click › Import audio here.",
  "view.collapseAll": "Collapse all sections", "view.expandAll": "Expand all sections", "view.fullPaths": "Show full file paths",
  "view.renumber": "Renumber all cues…", "view.newSection": "+ New section", "view.demo": "Load demo show",
  "sel.selected": "cues selected", "sel.applies": "· changes apply to all of them", "sel.colour": "Colour",
  "sel.move": "Move to section", "sel.duplicate": "Duplicate", "sel.delete": "Delete", "sel.clear": "Clear selection",
  "media.all": "All", "media.used": "Used", "media.unused": "Unused", "media.problems": "Problems",
  "media.add": "Add to show", "media.addPad": "Add as pad", "media.notUsed": "not used yet", "media.nothing": "Nothing here.",
  "media.dropHint": "Drag audio files from Windows Explorer onto this window to add them to the show.",
  // Inspector
  "insp.basics": "Basics", "insp.sound": "Sound", "insp.timing": "Timing", "insp.notes": "Notes",
  "insp.openEditor": "OPEN CUE EDITOR", "insp.preview": "Preview", "insp.stopPreview": "Stop preview",
  // Settings
  "set.title": "SETTINGS", "set.autosave": "Changes save by themselves · Esc closes",
  "set.backBuild": "Back to Build", "set.backPreflight": "Back to Preflight", "set.backRun": "Back to the show",
  "set.laptop": "THIS LAPTOP", "set.show": "THIS SHOW", "set.tools": "TOOLS",
  "set.audio": "Audio & output", "set.run": "Run & booth", "set.look": "Language & look", "set.shortcuts": "Shortcuts",
  "set.levels": "Levels & fades", "set.background": "Background music", "set.importTools": "Import & tools", "set.about": "About",
  "set.storedLaptop": "Remembered on this laptop.", "set.storedShow": "Saved in the show file, so these travel with the show to another laptop.",
  "set.dumboOn": "Dumbo mode on",
  "set.runPaused": "The show keeps playing · GO and Stop all are paused while Settings is open · Esc goes back",
  "set.showLocked": "Locked during the show. Go to Build to change the show's settings.",
  "set.dumboText": "Huge GO, what's playing, what's next, STOP ALL. Every other key does nothing. Leave by holding the corner button for 3 s, or with a PIN.",
  // Add window
  "add.title": "Add to the show", "add.files": "Audio files", "add.yt": "YouTube & lists", "add.pad": "Soundboard pad", "add.section": "Section",
  "add.drop": "Drop audio files here", "add.formats": "MP3, M4A, WAV, FLAC, OGG", "add.choose": "Choose files…",
  "add.padHint": "Drop a short sound (applause, gong, ding) to make a soundboard pad. It gets the next free key, 1–9 then 0.",
  "add.sectionName": "Section name", "add.addSection": "Add section", "add.newSection": "New section",
  "add.to": "Add to", "add.afterCue": "After cue", "add.endOf": "End of", "add.after": "After", "add.importSettings": "Import settings…",
  "drop.cues": "Drop audio files to add cues", "drop.pads": "Drop audio files to add pads",
  // preflight
  "pre.title": "Preflight", "pre.goRun": "GO TO RUN", "pre.ready": "Ready for the show", "pre.open": "open",
  "pre.byApp": "Checked by the app", "pre.yours": "Your checks",
  // dialogs
  cancel: "Cancel", close: "Close", done: "Done",
  // Dumbo mode
  "dumbo.hint": "Press SPACE when the stage is ready", "dumbo.now": "Playing now", "dumbo.nothing": "Nothing is playing",
  "dumbo.next": "Next", "dumbo.end": "That was the last cue", "dumbo.leave": "Hold 3 s to leave Dumbo mode",
  "dumbo.pin": "Enter the PIN to leave Dumbo mode", "dumbo.wrong": "Wrong PIN",
  "dumbo.fixFirst": "Fix these first, then Dumbo mode.",
} as const;

export type TKey = keyof typeof en;

const nl: Partial<Record<TKey, string>> = {
  "mode.build": "BOUWEN", "mode.preflight": "CHECK", "mode.run": "SHOW",
  "top.time": "Uur", "top.show": "Show", "top.notSaved": "nog niet bewaard", "top.booth": "REGIE", "top.settings": "Instellingen",
  "top.left": "te gaan",
  "top.saved": "bewaard", "top.unsaved": "niet bewaard", "top.fileMenu": "Showmenu: bestandsacties", "top.background": "Achtergrond", "out.choose": "Uitgang kiezen…",
  "file.new": "Nieuwe show", "file.open": "Openen…", "file.recent": "Recent geopend", "file.noRecent": "Geen recente shows",
  "file.save": "Bewaren", "file.saveAs": "Bewaren als…", "file.exportZip": "Show als zip exporteren…", "file.print": "Cueblad afdrukken…",
  "file.settings": "Instellingen…", "file.rename": "Show hernoemen…",
  go: "GO", stopAll: "ALLES STOP", panic: "PANIEK", "run.nowPlaying": "Speelt nu", "run.silence": "Stilte · GO speelt",
  "run.upNext": "Hierna", "run.standby": "Klaar", "run.then": "Dan", "run.skipTo": "Spring naar", "run.makeNext": "Maak volgende",
  "run.sections": "Delen", "run.endOfShow": "Einde van de show",
  "build.undo": "Ongedaan maken", "build.redo": "Opnieuw",
  "rail.cues": "Cues", "rail.pads": "Pads", "rail.media": "Media",
  "build.add": "Toevoegen", "build.find": "Cue zoeken…", "build.view": "Beeld",
  "build.tip": "Tip: rechtsklik op een cue of deel voor al de rest. Ctrl/Shift-klik selecteert er meerdere.",
  "build.noMatch": "Geen cue gevonden voor", "build.emptySection": "Leeg deel. Sleep cues hierheen, of rechtsklik › Audio hier importeren.",
  "view.collapseAll": "Alle delen dichtklappen", "view.expandAll": "Alle delen openklappen", "view.fullPaths": "Volledige bestandspaden tonen",
  "view.renumber": "Alle cues hernummeren…", "view.newSection": "+ Nieuw deel", "view.demo": "Demoshow laden",
  "sel.selected": "cues geselecteerd", "sel.applies": "· wijzigingen gelden voor allemaal", "sel.colour": "Kleur",
  "sel.move": "Naar deel verplaatsen", "sel.duplicate": "Dupliceren", "sel.delete": "Verwijderen", "sel.clear": "Selectie wissen",
  "media.all": "Alles", "media.used": "Gebruikt", "media.unused": "Ongebruikt", "media.problems": "Problemen",
  "media.add": "Aan show toevoegen", "media.addPad": "Als pad toevoegen", "media.notUsed": "nog niet gebruikt", "media.nothing": "Niets hier.",
  "media.dropHint": "Sleep audiobestanden vanuit Verkenner naar dit venster om ze aan de show toe te voegen.",
  "insp.basics": "Basis", "insp.sound": "Geluid", "insp.timing": "Timing", "insp.notes": "Notities",
  "insp.openEditor": "CUE-EDITOR OPENEN", "insp.preview": "Beluisteren", "insp.stopPreview": "Stop beluisteren",
  "set.title": "INSTELLINGEN", "set.autosave": "Wijzigingen worden vanzelf bewaard · Esc sluit",
  "set.backBuild": "Terug naar Bouwen", "set.backPreflight": "Terug naar Check", "set.backRun": "Terug naar de show",
  "set.laptop": "DEZE LAPTOP", "set.show": "DEZE SHOW", "set.tools": "HULPMIDDELEN",
  "set.audio": "Audio & uitgang", "set.run": "Show & regie", "set.look": "Taal & uiterlijk", "set.shortcuts": "Sneltoetsen",
  "set.levels": "Niveaus & fades", "set.background": "Achtergrondmuziek", "set.importTools": "Import & hulpmiddelen", "set.about": "Over",
  "set.storedLaptop": "Onthouden op deze laptop.", "set.storedShow": "Bewaard in het showbestand, dus ze reizen mee naar een andere laptop.",
  "set.dumboOn": "Dumbo-modus aan",
  "set.runPaused": "De show speelt verder · GO en Alles stop werken niet zolang Instellingen open is · Esc gaat terug",
  "set.showLocked": "Vergrendeld tijdens de show. Ga naar Bouwen om de instellingen van de show te wijzigen.",
  "set.dumboText": "Enorme GO, wat speelt, wat volgt, ALLES STOP. Alle andere toetsen doen niets. Verlaten door de hoekknop 3 s ingedrukt te houden, of met een pincode.",
  "add.title": "Toevoegen aan de show", "add.files": "Audiobestanden", "add.yt": "YouTube & lijsten", "add.pad": "Soundboard-pad", "add.section": "Deel",
  "add.drop": "Sleep audiobestanden hierheen", "add.formats": "MP3, M4A, WAV, FLAC, OGG", "add.choose": "Bestanden kiezen…",
  "add.padHint": "Sleep een kort geluid (applaus, gong, ding) hierheen om er een soundboard-pad van te maken. Het krijgt de volgende vrije toets, 1–9 en dan 0.",
  "add.sectionName": "Naam van het deel", "add.addSection": "Deel toevoegen", "add.newSection": "Nieuw deel",
  "add.to": "Toevoegen aan", "add.afterCue": "Na cue", "add.endOf": "Einde van", "add.after": "Na", "add.importSettings": "Importinstellingen…",
  "drop.cues": "Sleep audiobestanden hierheen om cues toe te voegen", "drop.pads": "Sleep audiobestanden hierheen om pads toe te voegen",
  "pre.title": "Check", "pre.goRun": "NAAR DE SHOW", "pre.ready": "Klaar voor de show", "pre.open": "open",
  "pre.byApp": "Gecontroleerd door de app", "pre.yours": "Jouw controles",
  cancel: "Annuleren", close: "Sluiten", done: "Klaar",
  "dumbo.hint": "Druk op SPATIE als het podium klaar is", "dumbo.now": "Speelt nu", "dumbo.nothing": "Er speelt niets",
  "dumbo.next": "Hierna", "dumbo.end": "Dat was de laatste cue", "dumbo.leave": "3 s ingedrukt houden om Dumbo-modus te verlaten",
  "dumbo.pin": "Geef de pincode om Dumbo-modus te verlaten", "dumbo.wrong": "Verkeerde pincode",
  "dumbo.fixFirst": "Los deze eerst op, dan Dumbo-modus.",
};

const dict: Record<Lang, Partial<Record<TKey, string>>> = { en, nl };

export function translate(lang: Lang, key: TKey): string {
  return dict[lang][key] ?? en[key];
}

/** Returns t(key) for the current language; re-renders when the language changes. */
export function useT() {
  const lang = useSettings((s) => s.ui.lang);
  return (key: TKey) => translate(lang, key);
}
