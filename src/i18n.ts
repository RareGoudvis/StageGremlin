// A small translation table: English and Dutch (Flemish) for the main labels.
// Use `useT()` in components: const t = useT(); t("go"). Missing Dutch strings fall back to English.

import { useSettings } from "./settingsStore";

export type Lang = "en" | "nl";

const en = {
  // top bar and modes
  "mode.build": "BUILD", "mode.preflight": "PREFLIGHT", "mode.run": "RUN",
  "top.time": "Time", "top.show": "Show", "top.notSaved": "not saved yet", "top.booth": "BOOTH", "top.settings": "Settings",
  "top.left": "left",
  // run
  go: "GO", stopAll: "STOP ALL", panic: "PANIC", "run.nowPlaying": "Now playing", "run.silence": "Silence · GO plays",
  "run.upNext": "Up next", "run.standby": "Standby", "run.then": "Then", "run.skipTo": "Skip to", "run.makeNext": "Make next",
  "run.sections": "Sections", "run.endOfShow": "End of show",
  // build
  "build.import": "+ Import audio", "build.section": "+ Section", "build.collapseAll": "Collapse all", "build.expandAll": "Expand all",
  "build.undo": "Undo", "build.redo": "Redo", "build.delete": "Delete", "build.new": "New", "build.open": "Open…",
  "build.save": "Save", "build.saveAs": "Save as…", "build.exportZip": "Export zip…", "build.print": "Print sheet",
  "build.fullPaths": "Full paths", "build.bin": "Media", "build.rename": "Rename", "build.addSection": "+ Add section",
  // preflight
  "pre.title": "Preflight", "pre.goRun": "GO TO RUN", "pre.ready": "Ready for the show", "pre.open": "open",
  "pre.byApp": "Checked by the app", "pre.yours": "Your checks",
  // dialogs
  cancel: "Cancel", close: "Close", done: "Done",
} as const;

export type TKey = keyof typeof en;

const nl: Partial<Record<TKey, string>> = {
  "mode.build": "BOUWEN", "mode.preflight": "CHECK", "mode.run": "SHOW",
  "top.time": "Uur", "top.show": "Show", "top.notSaved": "nog niet bewaard", "top.booth": "REGIE", "top.settings": "Instellingen",
  "top.left": "te gaan",
  go: "GO", stopAll: "ALLES STOP", panic: "PANIEK", "run.nowPlaying": "Speelt nu", "run.silence": "Stilte · GO speelt",
  "run.upNext": "Hierna", "run.standby": "Klaar", "run.then": "Dan", "run.skipTo": "Spring naar", "run.makeNext": "Maak volgende",
  "run.sections": "Delen", "run.endOfShow": "Einde van de show",
  "build.import": "+ Audio importeren", "build.section": "+ Deel", "build.collapseAll": "Alles dicht", "build.expandAll": "Alles open",
  "build.undo": "Ongedaan maken", "build.redo": "Opnieuw", "build.delete": "Verwijderen", "build.new": "Nieuw", "build.open": "Openen…",
  "build.save": "Bewaren", "build.saveAs": "Bewaren als…", "build.exportZip": "Zip exporteren…", "build.print": "Cueblad afdrukken",
  "build.fullPaths": "Volledige paden", "build.bin": "Media", "build.rename": "Hernoemen", "build.addSection": "+ Deel toevoegen",
  "pre.title": "Check", "pre.goRun": "NAAR DE SHOW", "pre.ready": "Klaar voor de show", "pre.open": "open",
  "pre.byApp": "Gecontroleerd door de app", "pre.yours": "Jouw controles",
  cancel: "Annuleren", close: "Sluiten", done: "Klaar",
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
