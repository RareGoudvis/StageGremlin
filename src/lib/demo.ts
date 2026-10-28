// A demo show for design work in the browser (no Tauri). Only offered when not running in the app.

import { useSettings } from "../settingsStore";
import { setAudacDemo } from "./audac";
import type { Pad, PadMode, Show } from "../types";
import { defaultSettings, newCue, newId, newSection, FORMAT_VERSION } from "../types";
import { useDoc } from "../store";
import { analyseCue } from "./fileActions";
import { allCues } from "../types";

export function demoShow(): Show {
  const opening = newSection("Opening");
  const klas = newSection("Klas 3A & 3B");
  const mic = newSection("Open mic");
  const pauze = newSection("Pauze");
  const finale = newSection("Finale");

  const intro = newCue({
    name: "Intro-montage", file: "C:/Schoolfeest/intro-montage.wav", color: "#7FB2FF",
    notes: { sound: "Na het belsignaal.", lx: "Zaallicht uit op de gong, volgspot op het midden.", stage: "Presentatoren klaar in de coulissen links." },
    markers: [{ t: 38, label: "gong" }],
  });
  opening.cues = [
    intro,
    newCue({ name: "Whoosh", file: "C:/Schoolfeest/whoosh.wav", color: "#FFB224", attach: { to: intro.id, at: 5 } }),
    newCue({ name: "Gong", file: "C:/Schoolfeest/gong.wav", color: "#FFB224", attach: { to: intro.id, at: 38 } }),
    newCue({
      name: "Opkomst presentatoren", file: "C:/Schoolfeest/opkomst.mp3", preWait: 1, fadeOut: 2, underDb: -12,
      notes: { sound: "Onder de stem tot ze aan de micro staan.", lx: "Warm frontlicht, 70%.", stage: "Micro 1 en 2 aan." },
    }),
  ];
  klas.cues = [
    newCue({
      name: "Dans 3A — Zomerhit", file: "C:/Schoolfeest/Zomerhit.m4a", color: "#C6F432", fadeOut: 3,
      vamp: { a: 0.5, b: 8.5, on: true },
      markers: [{ t: 32, label: "refrein" }, { t: 95, label: "freeze pose" }],
      notes: { sound: "Intro loopt tot alle kinderen staan, dan Release.", lx: "Kleurenchase op het refrein.", stage: "Klas 3A komt links op." },
    }),
    newCue({
      name: "Dans 3B — Medley", file: "C:/Schoolfeest/medley-3b.m4a", color: "#C6F432", fadeOut: 3, exclusive: "fade", exclusiveSecs: 4,
      follow: { kind: "afterEnd" }, comp: { on: true, thresholdDb: -20, ratio: 3, attackMs: 8, releaseMs: 120, makeupDb: 0 },
      notes: { sound: "Luid refrein vanaf 2:10. Loopt automatisch door.", lx: "Strobe uit! Warme wash.", stage: "Klas 3B rechts op." },
    }),
    newCue({ name: "Applaus-stinger", file: "C:/Schoolfeest/missing/applaus.wav", color: "#FFB224", preWait: 0.5, notes: { sound: "Volgt automatisch.", lx: "Zaal 30% voor buiging.", stage: "" } }),
  ];
  mic.cues = [
    newCue({ name: "Open mic — beat 1", file: "C:/Schoolfeest/beat-1.m4a", color: "#C9A2FF", fadeIn: 1, fadeOut: 3, exclusive: "crossfade", exclusiveSecs: 2, playCount: 0, notes: { sound: "Alleen als er een act klaarstaat.", lx: "Spot op de micro.", stage: "" } }),
    newCue({ name: "Open mic — beat 2", file: "C:/Schoolfeest/beat-2.m4a", color: "#C9A2FF", fadeIn: 1, fadeOut: 3, notes: { sound: "Rustiger tempo.", lx: "", stage: "" } }),
    newCue({ name: "Karaoke instrumentaal", file: "C:/Schoolfeest/karaoke-instr.m4a", color: "#C9A2FF", notes: { sound: "Tekst op scherm via de beamer.", lx: "Beamer aan, frontlicht 40%.", stage: "" } }),
  ];
  pauze.cues = [
    newCue({ name: "Pauze-aankondiging", file: "C:/Schoolfeest/pauze-jingle.wav", color: "#FFB224", notes: { sound: "Daarna achtergrond terug.", lx: "Zaallicht 100%.", stage: "" } }),
    newCue({ name: "Einde pauze — bel", file: "C:/Schoolfeest/bel.wav", color: "#FFB224", playCount: 3 }),
  ];
  finale.cues = [
    newCue({ name: "Slotlied — alle klassen", file: "C:/Schoolfeest/slotlied.mp3", color: "#FF7A6B", fadeOut: 4, notes: { sound: "Iedereen op het podium.", lx: "Volle wash, confetti op het slotakkoord.", stage: "Alle klassen op." } }),
    newCue({ name: "Uitloopmuziek", file: "C:/Schoolfeest/uitloop.mp3", color: "#7FB2FF", fadeIn: 2, playCount: 0, notes: { sound: "Tot de zaal leeg is.", lx: "Zaallicht 100%.", stage: "" } }),
  ];

  return { version: FORMAT_VERSION, name: "Schoolfeest 2027", settings: defaultSettings(), sections: [opening, klas, mic, pauze, finale], pads: demoPads() };
}

function demoPads(): Pad[] {
  const pad = (hotkey: string, name: string, file: string, color: string, mode: PadMode = "oneShot", duckBg = true): Pad => ({
    id: newId(), hotkey, mode, cue: newCue({ name, file: `C:/Schoolfeest/pads/${file}`, color, duckBg }),
  });
  return [
    pad("1", "Applaus", "applaus.wav", "#C6F432"),
    pad("2", "Lachband", "lachen.wav", "#FFB224"),
    pad("3", "Tromgeroffel", "drumroll.wav", "#FF7A6B", "loop"),
    pad("4", "Ding!", "ding.wav", "#7FB2FF", "oneShot", false),
    pad("5", "Fanfare", "fanfare.wav", "#C9A2FF"),
    pad("6", "Sad trombone", "sad-trombone.wav", "#FFB224"),
    pad("7", "Spanning", "drone.wav", "#7FB2FF", "toggle"),
    pad("8", "Gong", "gong.wav", "#C9A2FF", "oneShot", false),
  ];
}

export function loadDemoShow() {
  useDoc.getState().loadShow(demoShow(), null);
  if (!useSettings.getState().ui.audac.demo) void setAudacDemo(true);
  const s = useDoc.getState().show;
  for (const c of [...allCues(s), ...s.pads.map((p) => p.cue)]) void analyseCue(c.id);
}
