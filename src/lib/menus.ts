// What every right-click menu contains. Each builder returns a list of items for
// ContextMenu.tsx; the actions are the same functions the buttons and keys use.

import type { MenuItem } from "../components/ContextMenu";
import { useDoc } from "../store";
import { ask, useUi } from "../uiStore";
import type { Cue, Follow, Pad, PadMode, RunningInfo } from "../types";
import { allCues, goQueue } from "../types";
import { addSection, deleteSection, findAnyCue, moveCues, moveSection, PAD_KEYS, PAD_MODES, setSectionColor, updateAnyCue, updatePad } from "./showOps";
import { CUE_COLORS } from "./presets";
import { copyCues, cutCues, duplicateCues, pasteCues } from "./clipboard";
import { analyseCue, convertCue, importDialog, importPadsDialog } from "./fileActions";
import { locateCue, reloadCue, replaceCueFile, showInFolder, useMedia } from "./media";
import { previewToggle } from "./preview";
import { call, isTauri, needsConversion } from "./tauri";
import { makeNext, releaseVamp, skipTo, stopCue, toggleUnder } from "./runActions";
import { keyFor } from "../settingsStore";
import { deleteCues, deletePad } from "../components/build/Inspector";

const doc = () => useDoc.getState();

/** Apply a change to several cues as one undo step. */
function setCues(ids: string[], patch: Partial<Cue> | ((c: Cue) => Partial<Cue>)) {
  doc().edit((s) => ids.reduce((acc, id) => updateAnyCue(acc, id, patch), s));
}

function colourItems(current: string | null | undefined, apply: (c: string | null) => void): MenuItem[] {
  return [
    { label: "None", swatch: null, checked: current === null, onClick: () => apply(null) },
    ...CUE_COLORS.map((c) => ({ label: c.name, swatch: c.value, checked: current?.toUpperCase() === c.value, onClick: () => apply(c.value) })),
  ];
}

// ---------------------------------------------------------------- Build: cue rows

/** Right-click on a cue row. If the cue isn't selected, it becomes the selection first. */
export function cueMenu(cueId: string): MenuItem[] {
  if (!doc().selection.includes(cueId)) doc().select(cueId);
  const show = doc().show;
  const ids = doc().selection;
  const cues = ids.map((id) => findAnyCue(show, id)).filter((c): c is Cue => !!c);
  const cue = findAnyCue(show, cueId)!;
  const many = cues.length > 1;
  const all = <T,>(get: (c: Cue) => T, v: T) => cues.every((c) => get(c) === v);
  const missing = useMedia.getState().missing[cueId];
  const status = doc().analysis[cueId];
  const parents = goQueue(show).filter((c) => !ids.includes(c.id) && !c.attach);

  const follow = (f: Follow): MenuItem => ({
    label: f.kind === "none" ? "None (wait for GO)" : f.kind === "afterEnd" ? "After end" : `After start + ${f.delay} s`,
    checked: all((c) => c.follow.kind, f.kind),
    onClick: () => setCues(ids, { follow: f }),
  });

  return [
    { label: many ? `${cues.length} cues selected` : `${cue.number} ${cue.name}`, disabled: true },
    { label: "Edit in cue editor", shortcut: "Enter", disabled: many, onClick: () => useUi.getState().openEditor(cueId) },
    { label: "Preview", shortcut: keyFor("preview"), onClick: () => previewToggle(cue) },
    { label: "Set as standby", disabled: !!cue.attach, onClick: () => void call("engine_set_playhead", { cueId }) },
    "sep",
    { label: "Cut", shortcut: keyFor("cut"), onClick: cutCues },
    { label: "Copy", shortcut: keyFor("copy"), onClick: copyCues },
    { label: "Paste after", shortcut: keyFor("paste"), onClick: pasteCues },
    { label: "Duplicate", shortcut: keyFor("duplicate"), onClick: duplicateCues },
    "sep",
    { label: "Colour", submenu: colourItems(many ? undefined : cue.color, (color) => setCues(ids, { color })) },
    { label: "Follow", submenu: [follow({ kind: "none" }), follow({ kind: "afterEnd" }), follow({ kind: "afterStart", delay: 5 }), follow({ kind: "afterStart", delay: 10 })] },
    {
      label: "Play count",
      submenu: [1, 2, 3, 4, 5, 0].map((n) => ({ label: n === 0 ? "Loop" : `${n}×`, checked: all((c) => c.playCount, n), onClick: () => setCues(ids, { playCount: n }) })),
    },
    { label: "Duck background", checked: all((c) => c.duckBg, true), onClick: () => setCues(ids, { duckBg: !all((c) => c.duckBg, true) }) },
    {
      label: "Fade & GO",
      submenu: [null, 2, 4].map((v) => ({ label: v === null ? "Off" : `Fade others ${v} s`, checked: all((c) => c.fadeGo, v), onClick: () => setCues(ids, { fadeGo: v }) })),
    },
    {
      label: "Attach to",
      disabled: many || !parents.length,
      submenu: [
        { label: "Not attached (GO cue)", checked: !cue.attach, onClick: () => setCues(ids, { attach: null }) },
        "sep",
        ...parents.slice(0, 40).map((p) => ({ label: `${p.number} ${p.name}`, checked: cue.attach?.to === p.id, onClick: () => setCues(ids, { attach: { to: p.id, at: cue.attach?.at ?? 0 } }) })),
      ],
    },
    {
      label: "Move to section",
      submenu: show.sections.map((s) => ({ label: s.name, onClick: () => doc().edit((sh) => moveCues(sh, ids, s.id, null)) })),
    },
    "sep",
    ...(missing ? [{ label: "Locate…", onClick: () => void locateCue(cueId) }] : []),
    { label: "Reload from disk", disabled: many || !!missing, onClick: () => void reloadCue(cueId) },
    { label: "Replace…", disabled: many, onClick: () => void replaceCueFile(cueId) },
    ...(isTauri ? [{ label: "Show in folder", disabled: many || !!missing, onClick: () => void showInFolder(cueId) }] : []),
    { label: "Re-analyse", onClick: () => ids.forEach((id) => void analyseCue(id)) },
    ...(needsConversion(cue.file) || (status?.state === "error" && status.unsupported)
      ? [{ label: "Convert to M4A", onClick: () => ids.forEach((id) => void convertCue(id)) }]
      : []),
    "sep",
    { label: many ? `Delete ${cues.length} cues` : "Delete", shortcut: "Del", danger: true, onClick: () => void deleteCues(ids) },
  ];
}

// ---------------------------------------------------------------- Build: sections and the empty list

export async function deleteSectionAsk(sectionId: string) {
  const sec = doc().show.sections.find((s) => s.id === sectionId);
  if (!sec) return;
  const n = sec.cues.length;
  const ok = n === 0 || (await ask({
    title: "Delete section?",
    body: `“${sec.name}” and its ${n} cue${n > 1 ? "s" : ""} will be removed. Undo (Ctrl+Z) brings them back.`,
    confirmLabel: "Delete section",
    danger: true,
  }));
  if (ok) doc().edit((s) => deleteSection(s, sectionId));
}

export function sectionMenu(sectionId: string, rename: () => void): MenuItem[] {
  const show = doc().show;
  const i = show.sections.findIndex((s) => s.id === sectionId);
  const sec = show.sections[i];
  const collapsed = doc().collapsed[sectionId];
  return [
    { label: sec.name, disabled: true },
    { label: "Rename", onClick: rename },
    { label: "Colour", submenu: colourItems(sec.color, (c) => doc().edit((s) => setSectionColor(s, sectionId, c))) },
    { label: "Import audio here…", onClick: () => void importDialog(sectionId) },
    "sep",
    { label: collapsed ? "Expand" : "Collapse", onClick: () => doc().setCollapsed(sectionId, !collapsed) },
    {
      label: "Collapse the others",
      onClick: () => {
        doc().setAllCollapsed(true);
        doc().setCollapsed(sectionId, false);
      },
    },
    { label: "Move up", disabled: i === 0, onClick: () => doc().edit((s) => moveSection(s, sectionId, -1)) },
    { label: "Move down", disabled: i === show.sections.length - 1, onClick: () => doc().edit((s) => moveSection(s, sectionId, 1)) },
    { label: "New section below", onClick: () => doc().edit((s) => addSection(s, "New section", sectionId)) },
    "sep",
    { label: "Delete section", danger: true, onClick: () => void deleteSectionAsk(sectionId) },
  ];
}

export function listMenu(): MenuItem[] {
  return [
    { label: "Import audio…", shortcut: keyFor("importAudio"), onClick: () => void importDialog() },
    { label: "Import from YouTube…", shortcut: keyFor("youtube"), onClick: () => useUi.getState().openDialog({ kind: "youtube" }) },
    { label: "New section", onClick: () => doc().edit((s) => addSection(s, "New section")) },
    { label: "Paste", shortcut: keyFor("paste"), onClick: pasteCues },
  ];
}

// ---------------------------------------------------------------- Build: pads

export function padMenu(pad: Pad): MenuItem[] {
  doc().selectPad(pad.id);
  const set = (patch: Partial<Omit<Pad, "cue">>) => doc().edit((s) => updatePad(s, pad.id, patch));
  return [
    { label: `Pad ${pad.hotkey || "–"} · ${pad.cue.name}`, disabled: true },
    { label: "Edit", onClick: () => useUi.getState().openEditor(pad.cue.id) },
    { label: "Preview", shortcut: keyFor("preview"), onClick: () => previewToggle(pad.cue) },
    "sep",
    { label: "Hotkey", submenu: [{ label: "None", checked: !pad.hotkey, onClick: () => set({ hotkey: "" }) }, ...PAD_KEYS.map((k) => ({ label: k, checked: pad.hotkey === k, onClick: () => set({ hotkey: k }) }))] },
    { label: "Mode", submenu: PAD_MODES.map((m) => ({ label: m.label, checked: pad.mode === m.value, onClick: () => set({ mode: m.value as PadMode }) })) },
    { label: "Colour", submenu: colourItems(pad.cue.color, (color) => doc().edit((s) => updateAnyCue(s, pad.cue.id, { color }))) },
    { label: "Replace…", onClick: () => void replaceCueFile(pad.cue.id) },
    "sep",
    { label: "Import more pads…", onClick: () => void importPadsDialog() },
    { label: "Delete pad", danger: true, onClick: () => void deletePad(pad) },
  ];
}

// ---------------------------------------------------------------- Run (no destructive edits)

export function upNextMenu(cue: Cue, standbyId: string | null): MenuItem[] {
  const standby = cue.id === standbyId;
  return [
    { label: `${cue.number} ${cue.name}`, disabled: true },
    { label: "Skip to (stand by)", disabled: standby, onClick: () => skipTo(cue.id) },
    { label: "Make next…", disabled: standby, onClick: () => void makeNext(cue.id, standbyId) },
    { label: "Preview", shortcut: keyFor("preview"), onClick: () => previewToggle(cue) },
    { label: "Swap…", onClick: () => useUi.getState().openDialog({ kind: "swap", cueId: cue.id }) },
    { label: "Show notes", onClick: () => void showNotes(cue) },
  ];
}

export function nowPlayingMenu(run: RunningInfo): MenuItem[] {
  return [
    { label: `${run.number} ${run.name}`, disabled: true },
    { label: "Stop this", shortcut: keyFor("stopCue"), onClick: () => stopCue(run.cueId) },
    { label: run.under ? "Back up" : "Under", shortcut: keyFor("under"), onClick: () => toggleUnder(run.cueId) },
    { label: "Release vamp", shortcut: keyFor("releaseVamp"), disabled: !run.vamping, onClick: () => releaseVamp(run.cueId) },
    { label: "Swap…", onClick: () => useUi.getState().openDialog({ kind: "swap", cueId: run.cueId }) },
  ];
}

async function showNotes(cue: Cue) {
  const n = cue.notes;
  const body = [n.sound && `Sound: ${n.sound}`, n.lx && `Light: ${n.lx}`, n.stage && `Stage: ${n.stage}`].filter(Boolean).join("\n\n") || "No notes for this cue.";
  await ask({ title: `${cue.number} ${cue.name}`, body, confirmLabel: "OK", cancelLabel: "Close" });
}

// ---------------------------------------------------------------- Cue editor waveform

export function waveMenu(cue: Cue, t: number, actions: { setCursor: (t: number) => void; preview: (t: number) => void }): MenuItem[] {
  const set = (patch: Partial<Cue>) => doc().edit((s) => updateAnyCue(s, cue.id, patch));
  const dur = cue.loudness?.duration ?? 0;
  const out = Math.min(cue.trimOut ?? dur, dur);
  const r = Math.round(t * 10) / 10;
  const show = doc().show;
  const candidates = goQueue(show).filter((c) => c.id !== cue.id && !allCues(show).some((x) => x.attach?.to === c.id));
  const time = `${Math.floor(r / 60)}:${String(Math.floor(r % 60)).padStart(2, "0")}`;
  return [
    { label: `At ${time}`, disabled: true },
    { label: "Add marker here", onClick: () => set({ markers: [...cue.markers, { t: r, label: `marker ${cue.markers.length + 1}` }].sort((a, b) => a.t - b.t) }) },
    { label: "Set trim in here", disabled: r >= out - 0.5, onClick: () => set({ trimIn: r }) },
    { label: "Set trim out here", disabled: r <= cue.trimIn + 0.5, onClick: () => set({ trimOut: r >= dur - 0.05 ? null : r }) },
    { label: "Set vamp A here", onClick: () => set({ vamp: { a: r, b: Math.max(r + 0.5, cue.vamp?.b ?? r + 8), on: true } }) },
    { label: "Set vamp B here", disabled: !cue.vamp || r <= cue.vamp.a, onClick: () => cue.vamp && set({ vamp: { ...cue.vamp, b: r } }) },
    {
      label: "Attach a cue here",
      disabled: !!cue.attach || !candidates.length || !!show.pads.find((p) => p.cue.id === cue.id),
      submenu: candidates.slice(0, 40).map((c) => ({ label: `${c.number} ${c.name}`, onClick: () => doc().edit((s) => updateAnyCue(s, c.id, { attach: { to: cue.id, at: r } })) })),
    },
    "sep",
    { label: "Preview from here", shortcut: keyFor("preview"), onClick: () => { actions.setCursor(r); actions.preview(r); } },
  ];
}

