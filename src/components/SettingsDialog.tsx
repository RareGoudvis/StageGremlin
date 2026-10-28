// Settings (Settings button in the top bar or Ctrl+, — in every mode): a full page with a left nav grouped
// by where each setting is stored: THIS LAPTOP · THIS SHOW (in the .sg file) · TOOLS.
// Everything saves as you change it; Esc or "Back" closes. The pages live in settings/.
// In Run, Run's keys (GO, Stop all) pause while this is open, and the show's own settings are locked
// (Run never edits the show); laptop settings such as the output stay usable for emergencies.

import { useEffect, useState, type ReactNode } from "react";
import { useDoc } from "../store";
import { useUi } from "../uiStore";
import { useEngine } from "../engineStore";
import { useSettings } from "../settingsStore";
import { useT, type TKey } from "../i18n";
import { AboutPage, ToolsPage } from "./settings/ToolsPages";
import { AudioPage, LookPage, RunBoothPage, ShortcutsPage } from "./settings/LaptopPages";
import { BackgroundPage, LevelsPage } from "./settings/ShowPages";
import { AudacPage } from "./settings/AudacPage";
import { SchedulePage } from "./settings/SchedulePage";
import { StreamboxPage } from "./settings/StreamboxPage";
import { useAudac } from "../lib/audac";
import { settingsOpen } from "../lib/admin";

type Page = "audio" | "run" | "audac" | "streambox" | "schedule" | "look" | "shortcuts" | "levels" | "background" | "tools" | "about";

const NAV: ({ head: TKey } | { id: Page; label: TKey })[] = [
  { head: "set.laptop" },
  { id: "audio", label: "set.audio" },
  { id: "run", label: "set.run" },
  { id: "audac", label: "set.audac" },
  { id: "streambox", label: "set.streambox" },
  { id: "schedule", label: "set.schedule" },
  { id: "look", label: "set.look" },
  { id: "shortcuts", label: "set.shortcuts" },
  { head: "set.show" },
  { id: "levels", label: "set.levels" },
  { id: "background", label: "set.background" },
  { head: "set.tools" },
  { id: "tools", label: "set.importTools" },
  { id: "about", label: "set.about" },
];

const PAGES: Record<Page, () => ReactNode> = {
  audio: AudioPage, run: RunBoothPage, audac: AudacPage, streambox: StreamboxPage, schedule: SchedulePage, look: LookPage, shortcuts: ShortcutsPage,
  levels: LevelsPage, background: BackgroundPage, tools: ToolsPage, about: AboutPage,
};

let lastPage: Page = "audio";

export function SettingsDialog() {
  const close = useUi((s) => s.closeDialog);
  const t = useT();
  const mode = useDoc((s) => s.mode);
  // Opened with a page in mind (Add window › Import settings…), else the page used last.
  const asked = useUi((s) => (s.dialog?.kind === "settings" ? s.dialog.tab : undefined));
  const [page, setPageState] = useState<Page>(asked && asked in PAGES ? (asked as Page) : lastPage);
  const setPage = (p: Page) => { lastPage = p; setPageState(p); };
  const hints = useNavHints();
  // Admin stays unlocked between visits; half an hour with Settings closed locks it again.
  useEffect(() => {
    settingsOpen(true);
    return () => settingsOpen(false);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target as HTMLElement).closest("input, textarea, select") && !document.querySelector("[data-listening]")) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const Current = PAGES[page];
  return (
    <div role="dialog" aria-label={t("top.settings")} style={{ position: "absolute", inset: 0, zIndex: 66, background: "var(--bg)", display: "flex", flexDirection: "column" }}>
      <header style={{ height: 64, flex: "none", display: "flex", alignItems: "center", gap: 16, padding: "0 24px", borderBottom: "1px solid var(--line)" }}>
        <button className="b btn" onClick={close} style={{ height: 40 }}>‹ {mode === "run" ? t("set.backRun") : mode === "preflight" ? t("set.backPreflight") : mode === "background" ? t("set.backBackground") : t("set.backBuild")}</button>
        <span className="cond" style={{ fontSize: 26, fontWeight: 800, letterSpacing: ".04em" }}>{t("set.title")}</span>
        <span style={{ flex: 1 }} />
        {mode === "run" ? (
          <span style={{ fontSize: 13, fontWeight: 700, padding: "6px 10px", borderRadius: 8, background: "var(--ambbg)", color: "var(--ambtx)" }}>{t("set.runPaused")}</span>
        ) : (
          <span style={{ fontSize: 13, color: "var(--dim)" }}>{t("set.autosave")}</span>
        )}
      </header>
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {/* Left menu: soft panel; the open page is a raised white card. The grey hint sits under the label. */}
        <nav role="tablist" aria-orientation="vertical" aria-label={t("top.settings")} className="scroll" style={{ width: 270, flex: "none", padding: "14px 12px 20px", borderRight: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 2, background: "var(--p2)" }}>
          {NAV.map((x) =>
            "head" in x ? (
              <span key={x.head} className="k" style={{ padding: "16px 12px 6px", fontSize: 10.5 }}>{t(x.head)}</span>
            ) : (
              <button key={x.id} role="tab" aria-selected={page === x.id} className="b set-nav" onClick={() => setPage(x.id)}>
                <span className="clamp1" style={{ fontSize: 14.5, fontWeight: page === x.id ? 700 : 600 }}>{t(x.label)}</span>
                {hints[x.id] && <span className="clamp1" style={{ fontSize: 12, color: "var(--mute)" }}>{hints[x.id]}</span>}
              </button>
            ),
          )}
        </nav>
        <main className="scroll" style={{ flex: 1, minWidth: 0, padding: "28px 40px 40px" }}>
          <div style={{ maxWidth: 860, display: "flex", flexDirection: "column", gap: 18 }}>
            {mode === "run" && (page === "levels" || page === "background") ? (
              <>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ambtx)" }}>{t("set.showLocked")}</span>
                {/* A disabled fieldset greys out and blocks every control inside it. */}
                <fieldset disabled style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: "flex", flexDirection: "column", gap: 18, opacity: 0.6 }}>
                  <Current />
                </fieldset>
              </>
            ) : (
              <Current />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

/** The small grey text next to a nav item: the output in use, the loudness target, Dumbo on. */
function useNavHints(): Partial<Record<Page, string>> {
  const t = useT();
  const output = useEngine((s) => s.output);
  const lufs = useDoc((s) => s.show.settings.targetLufs);
  const dumbo = useSettings((s) => s.ui.dumbo);
  const mtx = useAudac();
  const timesOn = useSettings((s) => s.ui.audac.schedule.filter((e) => e.on).length);
  return {
    schedule: timesOn ? t("i.nav.timesOn", { n: timesOn }) : undefined,
    audac: mtx?.status === "connected" ? `● ${mtx.host}` : mtx?.status === "retrying" ? "○ …" : undefined,
    audio: output ? `${output.outputFound ? "●" : "○"} ${output.outputName}` : undefined,
    run: dumbo ? t("set.dumboOn") : t("i.nav.dumboOff"),
    levels: `${lufs} LUFS`.replace("-", "−"),
    tools: "yt-dlp, ffmpeg",
  };
}
