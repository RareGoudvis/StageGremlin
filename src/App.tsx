// The app frame: top bar, progress bar, the current screen, and overlays.

import { useEffect, useState } from "react";
import { effectiveTheme, useDoc, useDirty } from "./store";
import { TopBar, OutputBanner } from "./components/TopBar";
import { ShowProgress } from "./components/ShowProgress";
import { ConfirmDialog, Toast } from "./components/Overlays";
import { CueEditor } from "./components/editor/CueEditor";
import { YoutubeDialog } from "./components/youtube/YoutubeDialog";
import { SwapDialog } from "./components/run/SwapDialog";
import { ResumeDialog, useResumeCheck } from "./components/ResumeDialog";
import { PrintDialog, PrintSheet } from "./components/PrintSheet";
import { useUi } from "./uiStore";
import { SettingsDialog } from "./components/SettingsDialog";
import { BuildView } from "./views/BuildView";
import { PreflightView } from "./views/PreflightView";
import { RunView } from "./views/RunView";
import { useAppShortcuts } from "./hooks/useAppShortcuts";
import { usePreflight } from "./lib/preflight";
import { autoSave, importFiles } from "./lib/fileActions";
import { basename, onFileDrop, setWindowTitle } from "./lib/tauri";

const AUTOSAVE_MS = 30_000;

export default function App() {
  const mode = useDoc((s) => s.mode);
  const themePref = useDoc((s) => s.themePref);
  const theme = effectiveTheme(themePref, mode);
  const { allOk } = usePreflight();
  const dialog = useUi((s) => s.dialog);
  const booth = useUi((s) => s.booth);

  useAppShortcuts();
  useResumeCheck();
  useWindowTitle();
  useAutosave();
  const dropping = useFileDrop();

  return (
    <>
    <div className={`app th-${theme}${booth.red ? " red-mode" : ""}`} data-mode={mode}
      // Booth dimmer: darken everything (the overlay below handles values under 100 %).
      style={{ filter: booth.dim < 100 ? `brightness(${booth.dim / 100})` : undefined }}>
      <TopBar preflightOk={allOk} />
      <OutputBanner />
      <ShowProgress />
      <main style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {mode === "build" && <BuildView />}
        {mode === "preflight" && <PreflightView />}
        {mode === "run" && <RunView />}
      </main>
      {dropping && (
        <div style={{ position: "absolute", inset: 8, border: "3px dashed var(--acc)", borderRadius: 16, background: "var(--scrim)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
          <span className="cond" style={{ fontSize: 32, fontWeight: 800, color: "#fff" }}>Drop audio files to add cues</span>
        </div>
      )}
      <CueEditor />
      {dialog?.kind === "youtube" && <YoutubeDialog />}
      {dialog?.kind === "swap" && <SwapDialog cueId={dialog.cueId} />}
      {dialog?.kind === "resume" && <ResumeDialog />}
      {dialog?.kind === "print" && <PrintDialog />}
      {dialog?.kind === "settings" && <SettingsDialog />}
      <ConfirmDialog />
      <Toast />
    </div>
    {/* Only visible when printing (Ctrl+P). */}
    <PrintSheet />
    </>
  );
}

/** "Schoolfeest 2027 • — RG CuePlay" (the dot means unsaved changes). */
function useWindowTitle() {
  const name = useDoc((s) => s.show.name);
  const path = useDoc((s) => s.path);
  const dirty = useDirty();
  useEffect(() => {
    const shown = name || (path ? basename(path) : "Untitled");
    void setWindowTitle(`${shown}${dirty ? " •" : ""} — RG CuePlay`);
  }, [name, path, dirty]);
}

/** Every 30 s in Build: save if the show has a file and unsaved changes. */
function useAutosave() {
  useEffect(() => {
    const t = setInterval(() => void autoSave(), AUTOSAVE_MS);
    return () => clearInterval(t);
  }, []);
}

/** Audio files dragged from Explorer onto the window (Build only). */
function useFileDrop(): boolean {
  const [over, setOver] = useState(false);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let alive = true;
    void onFileDrop({
      over: (on) => setOver(on && useDoc.getState().mode === "build"),
      drop: (paths) => {
        if (useDoc.getState().mode === "build") importFiles(paths);
      },
    }).then((u) => (alive ? (unlisten = u) : u()));
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);
  return over;
}
