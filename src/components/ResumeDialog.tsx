// Crash resume: if the app closed unexpectedly while in Run, offer to pick up where it was.
// Also reports the session (show path + mode) to the shell, which writes the resume file.

import { useEffect, useState } from "react";
import { useDoc } from "../store";
import { useUi, toast } from "../uiStore";
import type { ResumeInfo } from "../types";
import { basename, call } from "../lib/tauri";
import { flushShowToEngine } from "../lib/engineSync";
import { fmtTime } from "../lib/format";

let info: ResumeInfo | null = null;

/** On startup: ask for resume info; keep app_session up to date afterwards. */
export function useResumeCheck() {
  useEffect(() => {
    call("app_resume_info").then(
      (r) => {
        if (r) {
          info = r;
          useUi.getState().openDialog({ kind: "resume" });
        }
      },
      (e) => console.warn("[cueplay] app_resume_info", e),
    );
  }, []);

  const path = useDoc((s) => s.path);
  const mode = useDoc((s) => s.mode);
  useEffect(() => {
    call("app_session", { showPath: path, mode }).catch((e) => console.warn("[cueplay] app_session", e));
  }, [path, mode]);
}

export function ResumeDialog() {
  const close = useUi((s) => s.closeDialog);
  const [busy, setBusy] = useState(false);
  if (!info) return null;
  const r = info;
  const first = r.running[0];
  const ago = Math.max(1, Math.round((Date.now() - r.savedAtMs) / 60000));

  const resume = async () => {
    setBusy(true);
    try {
      const show = await call("show_open", { path: r.showPath });
      useDoc.getState().loadShow(show, r.showPath);
      useDoc.getState().setMode("run");
      await flushShowToEngine();
      await call("engine_set_playhead", { cueId: r.playhead });
      if (r.running.length) await call("engine_resume", { items: r.running.map((x) => ({ cueId: x.cueId, position: x.position })) });
      await call("app_resume_dismiss");
      close();
    } catch (e) {
      toast(`Couldn't resume: ${e}`);
      setBusy(false);
    }
  };
  const dismiss = async () => {
    await call("app_resume_dismiss").catch(() => {});
    close();
  };

  return (
    <div className="scrim" style={{ zIndex: 80, padding: "120px 24px" }}>
      <div role="alertdialog" aria-label="Resume the show" className="dialog" style={{ maxWidth: 580, border: "2px solid var(--amb)" }}>
        <span className="cond" style={{ fontSize: 30, fontWeight: 800 }}>The app closed unexpectedly during the show</span>
        <span style={{ fontSize: 15, color: "var(--dim)", lineHeight: 1.45 }}>
          {basename(r.showPath)}, about {ago} minute{ago > 1 ? "s" : ""} ago.{" "}
          {first ? <>When it closed, <b style={{ color: "var(--text)" }}>{first.name}</b> was at <b className="mono" style={{ color: "var(--text)" }}>{fmtTime(first.position)}</b>{r.running.length > 1 ? ` (and ${r.running.length - 1} more)` : ""}.</> : "Nothing was playing."}
        </span>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 8 }}>
          <button className="b btn cond" disabled={busy} onClick={() => void resume()}
            style={{ height: 60, justifyContent: "center", background: "var(--gobg)", color: "var(--ongo)", fontSize: 20, fontWeight: 800 }}>
            {first ? `RESUME ${first.name} AT ${fmtTime(first.position)}` : "OPEN THE SHOW IN RUN"}
          </button>
          <button className="b btn" disabled={busy} onClick={() => void dismiss()} style={{ height: 60 }}>Dismiss</button>
        </div>
      </div>
    </div>
  );
}
