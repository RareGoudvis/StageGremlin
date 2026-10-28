// The cue's file: path, loudness, analysis state, and the file actions
// (reload, replace, show in folder, "Convert to M4A" for formats the decoder can't play).
// Lives on the inspector's File tab and in the cue editor. It only turns red when something is wrong
// with the file; then Basics shows it too (see `fileProblem`), so a problem is never hidden on a tab.

import { useState, type ReactNode } from "react";
import { useDoc } from "../../store";
import type { Cue } from "../../types";
import { normGain } from "../../types";
import { convertCue } from "../../lib/fileActions";
import { locateCue, reloadCue, replaceCueFile, showInFolder, useMedia } from "../../lib/media";
import { isTauri } from "../../lib/tauri";
import { fmtDb, fmtTime } from "../../lib/format";
import { useT } from "../../i18n";
import { ToolInstall } from "../ToolInstall";

/** True when the cue's file is missing or can't be read: worth showing outside the File tab. */
export function useFileProblem(cue: Cue): boolean {
  const status = useDoc((s) => s.analysis[cue.id]);
  const missing = useMedia((s) => !!s.missing[cue.id]);
  return missing || status?.state === "error";
}

export function FileStatus({ cue }: { cue: Cue }) {
  const t = useT();
  const status = useDoc((s) => s.analysis[cue.id]);
  const settings = useDoc((s) => s.show.settings);
  const [needFfmpeg, setNeedFfmpeg] = useState(false);
  const norm = normGain(cue.loudness, settings);
  const missing = useMedia((s) => !!s.missing[cue.id]);
  const bad = status?.state === "error" || missing;
  const unsupported = status?.state === "error" && status.unsupported;

  const convert = async () => {
    const ok = await convertCue(cue.id);
    setNeedFfmpeg(!ok);
  };
  const small = { height: 30, fontSize: 12.5 } as const;
  const strong = { ...small, background: "var(--red)", color: "var(--onred)", fontWeight: 700 } as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, ...(bad ? { padding: 12, borderRadius: 10, background: "var(--redbg)", border: "1px solid var(--red)" } : {}) }}>
      {bad && (
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--redtx)" }}>
          {missing ? t("i.file.missing") : unsupported ? t("i.file.unsupported") : t("i.file.unreadable")}
        </span>
      )}
      <Fact label={t("i.file.path")}>
        <span className="mono" style={{ fontSize: 12, wordBreak: "break-all", userSelect: "text" }}>{cue.file || t("i.file.none")}</span>
      </Fact>
      {cue.swappedFrom && (
        <Fact label={t("i.file.swappedFrom")}>
          <span className="mono" style={{ fontSize: 12, color: "var(--ambtx)", wordBreak: "break-all" }}>{cue.swappedFrom}</span>
        </Fact>
      )}
      {status?.state === "busy" && <span className="tag pulse" style={{ alignSelf: "flex-start" }}>{t("i.file.analysing")}</span>}
      {status?.state === "converting" && <span className="tag pulse" style={{ alignSelf: "flex-start" }}>{t("i.file.converting")}</span>}
      {cue.loudness && !bad && (
        <>
          <Fact label={t("i.file.length")}><span className="mono">{fmtTime(cue.loudness.duration)}</span></Fact>
          <Fact label={t("i.file.loudness")}><span className="mono">{cue.loudness.lufs.toFixed(1)} LUFS</span></Fact>
          <Fact label={t("i.file.peak")}><span className="mono">{cue.loudness.truePeakDb.toFixed(1)} dBTP</span></Fact>
          <Fact label={t("i.file.gain")}>
            <span className="mono" title={norm.peakLimited ? t("i.file.peakLimitedHint", { db: settings.peakCeilingDb }) : t("i.file.matchedHint", { lufs: settings.targetLufs })}>
              {fmtDb(norm.gainDb)}
            </span>
            {norm.peakLimited && <span className="tag tag-amb">{t("i.file.peakLimited")}</span>}
          </Fact>
        </>
      )}
      {!cue.loudness && !status && <span className="tag tag-amb" style={{ alignSelf: "flex-start" }}>{t("i.file.notAnalysed")}</span>}
      {!missing && status?.state === "error" && status.message && <span style={{ fontSize: 12, color: "var(--redtx)" }}>{status.message}</span>}
      {missing && <span style={{ fontSize: 12.5, color: "var(--redtx)", lineHeight: 1.4 }}>{t("i.file.missingHelp")}</span>}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {unsupported && <button className="b btn" style={strong} onClick={() => void convert()}>{t("i.file.convert")}</button>}
        {missing && <button className="b btn" style={strong} onClick={() => void locateCue(cue.id)}>{t("i.file.locate")}</button>}
        {!unsupported && !missing && <button className="b btn" style={small} onClick={() => void reloadCue(cue.id)}>{t("i.file.reload")}</button>}
        <button className="b btn" style={small} onClick={() => void replaceCueFile(cue.id)}>{t("i.file.replace")}</button>
        {isTauri && !missing && <button className="b btn" style={small} onClick={() => void showInFolder(cue.id)}>{t("i.file.showInFolder")}</button>}
      </div>
      {needFfmpeg && <ToolInstall what="ffmpeg" why={t("i.file.needFfmpeg")} />}
    </div>
  );
}

/** One labelled fact about the file: label on the left, value on the right. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "92px minmax(0, 1fr)", alignItems: "baseline", gap: 8 }}>
      <span style={{ fontSize: 13, color: "var(--dim)" }}>{label}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, minWidth: 0 }}>{children}</span>
    </div>
  );
}
