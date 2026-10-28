// What every right-click menu contains. Each builder returns a list of items for
// ContextMenu.tsx; the actions are the same functions the buttons and keys use.

import type { MenuItem } from "../components/ContextMenu";
import { useDoc } from "../store";
import { ask, useUi } from "../uiStore";
import type { Cue, Exclusive, Follow, Pad, PadMode, RunningInfo } from "../types";
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
import { tr, type TKey } from "../i18n";
import { colourName, padModeLabel } from "./labels";

const doc = () => useDoc.getState();

/** Apply a change to several cues as one undo step. */
function setCues(ids: string[], patch: Partial<Cue> | ((c: Cue) => Partial<Cue>)) {
  doc().edit((s) => ids.reduce((acc, id) => updateAnyCue(acc, id, patch), s));
}

function colourItems(current: string | null | undefined, apply: (c: string | null) => void): MenuItem[] {
  return [
    { label: tr("b.none"), swatch: null, checked: current === null, onClick: () => apply(null) },
    ...CUE_COLORS.map((c) => ({ label: colourName(tr, c.name), swatch: c.value, checked: current?.toUpperCase() === c.value, onClick: () => apply(c.value) })),
  ];
}

// ---------------------------------------------------------------- Build: cue rows

/** "When this starts": what happens to the cues already playing (text keys, translated when the menu opens). */
const EXCLUSIVE_CHOICES: { value: Exclusive; label: TKey }[] = [
  { value: "off", label: "b.m.exOff" },
  { value: "stop", label: "b.m.exStop" },
  { value: "fade", label: "b.m.exFade" },
  { value: "crossfade", label: "b.m.exCrossfade" },
];

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
    label: f.kind === "none" ? tr("b.m.folNone") : f.kind === "afterEnd" ? tr("b.m.folAfterEnd") : tr("b.m.folAfterStart", { n: f.delay }),
    checked: all((c) => c.follow.kind, f.kind),
    onClick: () => setCues(ids, { follow: f }),
  });

  return [
    { label: many ? tr("b.m.nSelected", { n: cues.length }) : `${cue.number} ${cue.name}`, disabled: true },
    { label: tr("b.m.editInEditor"), shortcut: "Enter", disabled: many, onClick: () => useUi.getState().openEditor(cueId) },
    { label: tr("insp.preview"), shortcut: keyFor("preview"), onClick: () => previewToggle(cue) },
    { label: tr("b.m.setStandby"), disabled: !!cue.attach, onClick: () => void call("engine_set_playhead", { cueId }) },
    "sep",
    { label: tr("b.m.cut"), shortcut: keyFor("cut"), onClick: cutCues },
    { label: tr("sbx.copy"), shortcut: keyFor("copy"), onClick: copyCues },
    { label: tr("b.m.pasteAfter"), shortcut: keyFor("paste"), onClick: pasteCues },
    { label: tr("sel.duplicate"), shortcut: keyFor("duplicate"), onClick: duplicateCues },
    "sep",
    { label: tr("sel.colour"), submenu: colourItems(many ? undefined : cue.color, (color) => setCues(ids, { color })) },
    { label: tr("b.m.follow"), submenu: [follow({ kind: "none" }), follow({ kind: "afterEnd" }), follow({ kind: "afterStart", delay: 5 }), follow({ kind: "afterStart", delay: 10 })] },
    {
      label: tr("b.m.playCount"),
      submenu: [1, 2, 3, 4, 5, 0].map((n) => ({ label: n === 0 ? tr("b.loop") : `${n}×`, checked: all((c) => c.playCount, n), onClick: () => setCues(ids, { playCount: n }) })),
    },
    { label: tr("b.m.duck"), checked: all((c) => c.duckBg, true), onClick: () => setCues(ids, { duckBg: !all((c) => c.duckBg, true) }) },
    {
      label: tr("b.m.whenStarts"),
      submenu: EXCLUSIVE_CHOICES.map((x) => ({ label: tr(x.label), checked: all((c) => c.exclusive, x.value), onClick: () => setCues(ids, { exclusive: x.value }) })),
    },
    {
      label: tr("b.m.attachTo"),
      disabled: many || !parents.length,
      submenu: [
        { label: tr("b.m.notAttached"), checked: !cue.attach, onClick: () => setCues(ids, { attach: null }) },
        "sep",
        ...parents.slice(0, 40).map((p) => ({ label: `${p.number} ${p.name}`, checked: cue.attach?.to === p.id, onClick: () => setCues(ids, { attach: { to: p.id, at: cue.attach?.at ?? 0 } }) })),
      ],
    },
    {
      label: tr("sel.move"),
      submenu: show.sections.map((s) => ({ label: s.name, onClick: () => doc().edit((sh) => moveCues(sh, ids, s.id, null)) })),
    },
    "sep",
    ...(missing ? [{ label: tr("b.m.locate"), onClick: () => void locateCue(cueId) }] : []),
    { label: tr("b.m.reload"), disabled: many || !!missing, onClick: () => void reloadCue(cueId) },
    { label: tr("b.m.replace"), disabled: many, onClick: () => void replaceCueFile(cueId) },
    ...(isTauri ? [{ label: tr("b.m.showInFolder"), disabled: many || !!missing, onClick: () => void showInFolder(cueId) }] : []),
    { label: tr("b.m.reanalyse"), onClick: () => ids.forEach((id) => void analyseCue(id)) },
    ...(needsConversion(cue.file) || (status?.state === "error" && status.unsupported)
      ? [{ label: tr("b.m.convert"), onClick: () => ids.forEach((id) => void convertCue(id)) }]
      : []),
    "sep",
    { label: many ? tr("b.m.deleteN", { n: cues.length }) : tr("sel.delete"), shortcut: "Del", danger: true, onClick: () => void deleteCues(ids) },
  ];
}

/** Build's selection bar: Colour ▾ for all selected cues. */
export function selectionColourMenu(ids: string[]): MenuItem[] {
  return colourItems(undefined, (color) => setCues(ids, { color }));
}

/** Build's selection bar: Move to section ▾ (to the end of that section). */
export function moveToSectionMenu(ids: string[]): MenuItem[] {
  return doc().show.sections.map((s) => ({ label: s.name, onClick: () => doc().edit((sh) => moveCues(sh, ids, s.id, null)) }));
}

// ---------------------------------------------------------------- Build: sections and the empty list

export async function deleteSectionAsk(sectionId: string) {
  const sec = doc().show.sections.find((s) => s.id === sectionId);
  if (!sec) return;
  const n = sec.cues.length;
  const ok = n === 0 || (await ask({
    title: tr("b.m.delSecTitle"),
    body: n > 1 ? tr("b.m.delSecBodyN", { name: sec.name, n }) : tr("b.m.delSecBody1", { name: sec.name }),
    confirmLabel: tr("b.m.deleteSection"),
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
    { label: tr("b.m.rename"), onClick: rename },
    { label: tr("sel.colour"), submenu: colourItems(sec.color, (c) => doc().edit((s) => setSectionColor(s, sectionId, c))) },
    { label: tr("b.m.importHere"), onClick: () => void importDialog(sectionId) },
    "sep",
    { label: collapsed ? tr("b.m.expand") : tr("b.m.collapse"), onClick: () => doc().setCollapsed(sectionId, !collapsed) },
    {
      label: tr("b.m.collapseOthers"),
      onClick: () => {
        doc().setAllCollapsed(true);
        doc().setCollapsed(sectionId, false);
      },
    },
    { label: tr("b.m.moveUp"), disabled: i === 0, onClick: () => doc().edit((s) => moveSection(s, sectionId, -1)) },
    { label: tr("b.m.moveDown"), disabled: i === show.sections.length - 1, onClick: () => doc().edit((s) => moveSection(s, sectionId, 1)) },
    { label: tr("b.m.newBelow"), onClick: () => doc().edit((s) => addSection(s, tr("add.newSection"), sectionId)) },
    "sep",
    { label: tr("b.m.deleteSection"), danger: true, onClick: () => void deleteSectionAsk(sectionId) },
  ];
}

export function listMenu(): MenuItem[] {
  return [
    { label: tr("b.m.importAudio"), shortcut: keyFor("importAudio"), onClick: () => void importDialog() },
    { label: tr("b.m.importYt"), shortcut: keyFor("youtube"), onClick: () => useUi.getState().openDialog({ kind: "add", tab: "yt" }) },
    { label: tr("add.newSection"), onClick: () => doc().edit((s) => addSection(s, tr("add.newSection"))) },
    { label: tr("b.m.paste"), shortcut: keyFor("paste"), onClick: pasteCues },
  ];
}

// ---------------------------------------------------------------- Build: pads

export function padMenu(pad: Pad): MenuItem[] {
  doc().selectPad(pad.id);
  const set = (patch: Partial<Omit<Pad, "cue">>) => doc().edit((s) => updatePad(s, pad.id, patch));
  return [
    { label: tr("b.m.padTitle", { key: pad.hotkey || "–", name: pad.cue.name }), disabled: true },
    { label: tr("b.m.edit"), onClick: () => useUi.getState().openEditor(pad.cue.id) },
    { label: tr("insp.preview"), shortcut: keyFor("preview"), onClick: () => previewToggle(pad.cue) },
    "sep",
    { label: tr("b.m.hotkey"), submenu: [{ label: tr("b.none"), checked: !pad.hotkey, onClick: () => set({ hotkey: "" }) }, ...PAD_KEYS.map((k) => ({ label: k, checked: pad.hotkey === k, onClick: () => set({ hotkey: k }) }))] },
    { label: tr("b.m.mode"), submenu: PAD_MODES.map((m) => ({ label: padModeLabel(tr, m.value, m.label), checked: pad.mode === m.value, onClick: () => set({ mode: m.value as PadMode }) })) },
    { label: tr("sel.colour"), submenu: colourItems(pad.cue.color, (color) => doc().edit((s) => updateAnyCue(s, pad.cue.id, { color }))) },
    { label: tr("b.m.replace"), onClick: () => void replaceCueFile(pad.cue.id) },
    "sep",
    { label: tr("b.m.importMorePads"), onClick: () => void importPadsDialog() },
    { label: tr("b.m.deletePad"), danger: true, onClick: () => void deletePad(pad) },
  ];
}

// ---------------------------------------------------------------- Run (no destructive edits)

export function upNextMenu(cue: Cue, standbyId: string | null): MenuItem[] {
  const standby = cue.id === standbyId;
  return [
    { label: `${cue.number} ${cue.name}`, disabled: true },
    { label: tr("b.m.skipTo"), disabled: standby, onClick: () => skipTo(cue.id) },
    { label: tr("b.m.makeNext"), disabled: standby, onClick: () => void makeNext(cue.id, standbyId) },
    { label: tr("insp.preview"), shortcut: keyFor("preview"), onClick: () => previewToggle(cue) },
    { label: tr("b.m.swap"), onClick: () => useUi.getState().openDialog({ kind: "swap", cueId: cue.id }) },
    { label: tr("b.m.showNotes"), onClick: () => void showNotes(cue) },
  ];
}

export function nowPlayingMenu(run: RunningInfo): MenuItem[] {
  return [
    { label: `${run.number} ${run.name}`, disabled: true },
    { label: tr("b.m.stopThis"), shortcut: keyFor("stopCue"), onClick: () => stopCue(run.cueId) },
    { label: run.under ? tr("b.m.backUp") : tr("b.m.under"), shortcut: keyFor("under"), onClick: () => toggleUnder(run.cueId) },
    { label: tr("b.m.releaseVamp"), shortcut: keyFor("releaseVamp"), disabled: !run.vamping, onClick: () => releaseVamp(run.cueId) },
    { label: tr("b.m.swap"), onClick: () => useUi.getState().openDialog({ kind: "swap", cueId: run.cueId }) },
  ];
}

async function showNotes(cue: Cue) {
  const n = cue.notes;
  const body = [n.sound && tr("b.m.noteSound", { text: n.sound }), n.lx && tr("b.m.noteLight", { text: n.lx }), n.stage && tr("b.m.noteStage", { text: n.stage })]
    .filter(Boolean).join("\n\n") || tr("b.m.noNotes");
  await ask({ title: `${cue.number} ${cue.name}`, body, confirmLabel: tr("b.m.ok"), cancelLabel: tr("close") });
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
    { label: tr("b.m.at", { t: time }), disabled: true },
    { label: tr("b.m.addMarker"), onClick: () => set({ markers: [...cue.markers, { t: r, label: tr("b.markerN", { n: cue.markers.length + 1 }) }].sort((a, b) => a.t - b.t) }) },
    { label: tr("b.m.setIn"), disabled: r >= out - 0.5, onClick: () => set({ trimIn: r }) },
    { label: tr("b.m.setOut"), disabled: r <= cue.trimIn + 0.5, onClick: () => set({ trimOut: r >= dur - 0.05 ? null : r }) },
    { label: tr("b.m.setVampA"), onClick: () => set({ vamp: { a: r, b: Math.max(r + 0.5, cue.vamp?.b ?? r + 8), on: true } }) },
    { label: tr("b.m.setVampB"), disabled: !cue.vamp || r <= cue.vamp.a, onClick: () => cue.vamp && set({ vamp: { ...cue.vamp, b: r } }) },
    {
      label: tr("b.m.attachHere"),
      disabled: !!cue.attach || !candidates.length || !!show.pads.find((p) => p.cue.id === cue.id),
      submenu: candidates.slice(0, 40).map((c) => ({ label: `${c.number} ${c.name}`, onClick: () => doc().edit((s) => updateAnyCue(s, c.id, { attach: { to: cue.id, at: r } })) })),
    },
    "sep",
    { label: tr("b.m.previewHere"), shortcut: keyFor("preview"), onClick: () => { actions.setCursor(r); actions.preview(r); } },
  ];
}

