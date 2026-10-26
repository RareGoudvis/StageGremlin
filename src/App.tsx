// The app frame: top bar, progress bar, the current screen, and overlays.

import { useEffect, useState } from "react";
import { effectiveTheme, useDoc, useDirty } from "./store";
import { TopBar, OutputBanner } from "./components/TopBar";
import { ShowProgress } from "./components/ShowProgress";
import { ConfirmDialog, Toast } from "./components/Overlays";
import { CueEditor } from "./components/editor/CueEditor";
import { AddDialog, dropOnAddDialog } from "./components/build/AddDialog";
import { SwapDialog } from "./components/run/SwapDialog";
import { ResumeDialog, useResumeCheck } from "./components/ResumeDialog";
import { PrintDialog, PrintSheet } from "./components/PrintSheet";
import { useUi } from "./uiStore";
import { SettingsDialog } from "./components/SettingsDialog";
import { useSettings } from "./settingsStore";
import { DumboView } from "./views/DumboView";
import { useMedia } from "./lib/media";
import { useT } from "./i18n";
import { useAudacAutoConnect } from "./lib/audac";
import { useAudacSchedule } from "./lib/audacSchedule";
import { ContextMenuHost } from "./components/ContextMenu";
import { BuildView } from "./views/BuildView";
import { PreflightView } from "./views/PreflightView";
import { RunView } from "./views/RunView";
import { useAppShortcuts } from "./hooks/useAppShortcuts";
import { usePreflight } from "./lib/preflight";
import { autoSave, importFiles, importPadFiles } from "./lib/fileActions";
import { basename, onFileDrop, setWindowTitle } from "./lib/tauri";

const AUTOSAVE_MS = 30_000;

export default function App() {
  const mode = useDoc((s) => s.mode);
  const themePref = useDoc((s) => s.themePref);
  const dumboOn = useSettings((s) => s.ui.dumbo);
  // Dumbo mode is a Run screen: the automatic theme goes black like Run.
  const theme = effectiveTheme(themePref, dumboOn ? "run" : mode);
  useEffect(() => {
    if (dumboOn && useDoc.getState().mode !== "run") useDoc.getState().setMode("run");
  }, [dumboOn]);
  // Same rule as Run: Dumbo mode can't stay on while a cue file is missing (for example when
  // it was left on and the show opens with a file gone). Preflight then lists what to fix.
  const missingCount = useMedia((s) => Object.keys(s.missing).length);
  useEffect(() => {
    if (dumboOn && missingCount > 0) {
      useSettings.getState().update({ dumbo: false });
      useMedia.setState({ dumboBlocked: true });
      useDoc.getState().setMode("preflight");
    }
  }, [dumboOn, missingCount]);
  const { allOk } = usePreflight();
  const dialog = useUi((s) => s.dialog);
  const booth = useUi((s) => s.booth);
  const zoom = useSettings((s) => s.ui.zoom);
  const dumbo = useSettings((s) => s.ui.dumbo);

  useAppShortcuts();
  useNoBrowserMenu();
  useResumeCheck();
  useWindowTitle();
  useAutosave();
  useAudacAutoConnect();
  useAudacSchedule();
  const dropping = useFileDrop();
  const buildTab = useDoc((s) => s.buildTab);
  const t = useT();

  return (
    <>
    <div className={`app th-${theme}${booth.red ? " red-mode" : ""}`} data-mode={mode}
      // Booth dimmer: darken everything (the overlay below handles values under 100 %).
      style={{ filter: booth.dim < 100 ? `brightness(${booth.dim / 100})` : undefined, zoom: zoom !== 100 ? zoom / 100 : undefined }}>
      {dumbo ? (
        // Dumbo mode replaces everything (no top bar, no mode switch): see DumboView.tsx.
        <>
          <OutputBanner />
          <DumboView />
        </>
      ) : (
        <>
          <TopBar preflightOk={allOk} />
          <OutputBanner />
          <ShowProgress />
          <main style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            {mode === "build" && <BuildView />}
            {mode === "preflight" && <PreflightView />}
            {mode === "run" && <RunView />}
          </main>
        </>
      )}
      {dropping && (
        <div style={{ position: "absolute", inset: 8, border: "3px dashed var(--acc)", borderRadius: 16, background: "var(--scrim)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
          <span className="cond" style={{ fontSize: 32, fontWeight: 800, color: "#fff" }}>{t(buildTab === "pads" ? "drop.pads" : "drop.cues")}</span>
        </div>
      )}
      <CueEditor />
      {dialog?.kind === "add" && <AddDialog tab={dialog.tab} />}
      {dialog?.kind === "swap" && <SwapDialog cueId={dialog.cueId} />}
      {dialog?.kind === "resume" && <ResumeDialog />}
      {dialog?.kind === "print" && <PrintDialog />}
      {dialog?.kind === "settings" && <SettingsDialog />}
      <ContextMenuHost />
      <ConfirmDialog />
      <Toast />
    </div>
    {/* Only visible when printing (Ctrl+P). */}
    <PrintSheet />
    </>
  );
}

/** "Schoolfeest 2027 • — StageGremlin" (the dot means unsaved changes). */
function useWindowTitle() {
  const name = useDoc((s) => s.show.name);
  const path = useDoc((s) => s.path);
  const dirty = useDirty();
  useEffect(() => {
    const shown = name || (path ? basename(path) : "Untitled");
    void setWindowTitle(`${shown}${dirty ? " •" : ""} — StageGremlin`);
  }, [name, path, dirty]);
}

/** Every 30 s in Build: save if the show has a file and unsaved changes. */
function useAutosave() {
  useEffect(() => {
    const t = setInterval(() => void autoSave(), AUTOSAVE_MS);
    return () => clearInterval(t);
  }, []);
}

/** Audio files dragged from Explorer onto the window (Build only): cues, pads, or into the Add window. */
function useFileDrop(): boolean {
  const [over, setOver] = useState(false);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let alive = true;
    void onFileDrop({
      over: (on) => setOver(on && useDoc.getState().mode === "build"),
      drop: (paths) => {
        const d = useDoc.getState();
        if (d.mode !== "build") return;
        // The Add window takes the files when open; otherwise the Pads view makes pads, the rest cues.
        if (dropOnAddDialog(paths)) return;
        if (d.buildTab === "pads") importPadFiles(paths);
        else importFiles(paths);
      },
    }).then((u) => (alive ? (unlisten = u) : u()));
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);
  return over;
}

/**
 * WebView2 would show the browser's own menu (Back, Reload, Inspect…) on right-click.
 * Our own menus replace it; text fields keep it so copy/paste still works there.
 */
function useNoBrowserMenu() {
  useEffect(() => {
    const onMenu = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("input, textarea, [contenteditable=true]")) e.preventDefault();
    };
    window.addEventListener("contextmenu", onMenu);
    return () => window.removeEventListener("contextmenu", onMenu);
  }, []);
}
