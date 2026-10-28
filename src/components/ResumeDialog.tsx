// Crash resume: if the app closed unexpectedly while in Run, offer to pick up where it was.
// Also reports the session (show path + mode) to the shell, which writes the resume file.

import { useEffect, useState } from "react";
import { useDoc } from "../store";
import { useUi, toast } from "../uiStore";
import type { ResumeInfo } from "../types";
import { basename, call } from "../lib/tauri";
import { flushShowToEngine } from "../lib/engineSync";
import { fmtTime } from "../lib/format";
import { tr, useT } from "../i18n";

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
    call("app_session", { showPath: path, mode: mode === "background" ? "build" : mode }).catch((e) => console.warn("[cueplay] app_session", e));
  }, [path, mode]);
}

export function ResumeDialog() {
  const close = useUi((s) => s.closeDialog);
  const [busy, setBusy] = useState(false);
  const t = useT();
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
      toast(tr("r.res.failed", { e: String(e) }));
      setBusy(false);
    }
  };
  const dismiss = async () => {
    await call("app_resume_dismiss").catch(() => {});
    close();
  };

  return (
    <div className="scrim" style={{ zIndex: 80, padding: "120px 24px" }}>
      <div role="alertdialog" aria-label={t("r.res.aria")} className="dialog" style={{ maxWidth: 580, border: "2px solid var(--amb)" }}>
        <span className="cond" style={{ fontSize: 30, fontWeight: 800 }}>{t("r.res.title")}</span>
        <span style={{ fontSize: 15, color: "var(--dim)", lineHeight: 1.45 }}>
          {ago > 1 ? t("r.res.agoN", { file: basename(r.showPath), n: ago }) : t("r.res.ago1", { file: basename(r.showPath) })}{" "}
          {first ? <>{t("r.res.when")} <b style={{ color: "var(--text)" }}>{first.name}</b> {t("r.res.wasAt")} <b className="mono" style={{ color: "var(--text)" }}>{fmtTime(first.position)}</b>{r.running.length > 1 ? t("r.res.more", { n: r.running.length - 1 }) : ""}.</> : t("r.res.nothing")}
        </span>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 8 }}>
          <button className="b btn cond" disabled={busy} onClick={() => void resume()}
            style={{ height: 60, justifyContent: "center", background: "var(--gobg)", color: "var(--ongo)", fontSize: 20, fontWeight: 800 }}>
            {first ? t("r.res.resume", { name: first.name ?? "", t: fmtTime(first.position) }) : t("r.res.openRun")}
          </button>
          <button className="b btn" disabled={busy} onClick={() => void dismiss()} style={{ height: 60 }}>{t("r.res.dismiss")}</button>
        </div>
      </div>
    </div>
  );
}
