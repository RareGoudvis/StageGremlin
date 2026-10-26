// The Add window (+ Add, Ctrl+I, Ctrl+Shift+Y): one place for everything that comes into the show.
// Tabs: Audio files · YouTube & lists · Soundboard pad · Section. The footer says where new cues go.
// Files dropped from Explorer while this window is open go to the open tab (see App.tsx useFileDrop).

import { useEffect, useState } from "react";
import { useDoc } from "../../store";
import { useUi, type AddTab } from "../../uiStore";
import { importFiles, importPadFiles, lastSelected } from "../../lib/fileActions";
import { addSection, findCue, locate } from "../../lib/showOps";
import { pickAudioFiles } from "../../lib/tauri";
import { useT, type TKey } from "../../i18n";
import { YoutubePanel, type AddTarget } from "../youtube/YoutubePanel";
import { Close, Upload } from "../Icons";

const TABS: { id: AddTab; label: TKey }[] = [
  { id: "files", label: "add.files" },
  { id: "yt", label: "add.yt" },
  { id: "pad", label: "add.pad" },
  { id: "section", label: "add.section" },
];

/** Set while the Add window is open: App.tsx hands dropped files to it instead of the cue list. */
let dropHandler: ((paths: string[]) => void) | null = null;
export function dropOnAddDialog(paths: string[]): boolean {
  if (!dropHandler) return false;
  dropHandler(paths);
  return true;
}

export function AddDialog({ tab: firstTab }: { tab?: AddTab }) {
  const t = useT();
  const close = useUi((s) => s.closeDialog);
  const show = useDoc((s) => s.show);
  const [tab, setTab] = useState<AddTab>(firstTab ?? "files");
  const [where, setWhere] = useState(() => defaultWhere());
  const [sectionName, setSectionName] = useState(t("add.newSection"));
  // The Section tab only offers sections: "after cue 3" becomes "after the section cue 3 is in".
  const shownWhere = tab === "section" && where.startsWith("after:") ? `end:${locate(show, where.slice(6))?.section.id ?? ""}` : where;
  const target = toTarget(shownWhere);

  const addFiles = (paths: string[]) => {
    if (!paths.length) return;
    if (tab === "pad") importPadFiles(paths);
    else importFiles(paths, target.sectionId, target.sectionId ? undefined : target.afterId);
    close();
  };
  const choose = async () => addFiles(await pickAudioFiles());

  const addNewSection = () => {
    // Right after the section the footer points at.
    useDoc.getState().edit((s) => addSection(s, sectionName.trim() || t("add.newSection"), target.sectionId ?? null));
    close();
  };

  useEffect(() => {
    dropHandler = tab === "files" || tab === "pad" ? addFiles : null;
    return () => { dropHandler = null; };
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target as HTMLElement).closest("input, textarea")) close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  return (
    <div className="scrim" style={{ zIndex: 66, padding: "40px 24px" }} onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-label={t("add.title")} className="dialog scroll" style={{ maxWidth: tab === "yt" ? 980 : 720, maxHeight: "100%", padding: 0, gap: 0 }}>
        <div style={{ display: "flex", alignItems: "center", padding: "18px 22px 12px" }}>
          <span style={{ flex: 1, fontSize: 20, fontWeight: 800 }}>{t("add.title")}</span>
          <button className="b btn btn-icon" aria-label={t("close")} onClick={close} style={{ width: 36, height: 36 }}><Close /></button>
        </div>
        <div role="tablist" style={{ display: "flex", gap: 6, padding: "0 22px 14px", flexWrap: "wrap" }}>
          {TABS.map((x) => (
            <button key={x.id} role="tab" aria-selected={tab === x.id} className="b" onClick={() => setTab(x.id)}
              style={{ height: 36, padding: "0 14px", borderRadius: 999, fontSize: 13, fontWeight: 700, border: tab === x.id ? "1px solid var(--hl)" : "1px solid var(--line)", background: tab === x.id ? "var(--hl)" : "var(--p1)", color: tab === x.id ? "var(--bg)" : "var(--text)" }}>
              {t(x.label)}
            </button>
          ))}
        </div>

        <div style={{ padding: "0 22px 18px", minHeight: 230, display: "flex", flexDirection: "column", gap: 14 }}>
          {(tab === "files" || tab === "pad") && (
            <>
              {tab === "pad" && <p style={{ margin: 0, fontSize: 14, color: "var(--dim)" }}>{t("add.padHint")}</p>}
              <button className="b" onClick={() => void choose()}
                style={{ height: 180, border: "2px dashed var(--line)", borderRadius: 14, background: "var(--p2)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: "var(--dim)" }}>
                <Upload />
                <span style={{ fontSize: 16, fontWeight: 600, color: "var(--text)" }}>{t("add.drop")}</span>
                <span style={{ fontSize: 13 }}>{t("add.formats")} · <u>{t("add.choose")}</u></span>
              </button>
            </>
          )}
          {tab === "yt" && <YoutubePanel target={target} />}
          {tab === "section" && (
            <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "var(--dim)" }}>
              {t("add.sectionName")}
              <input className="input" autoFocus value={sectionName} onChange={(e) => setSectionName(e.target.value)}
                onFocus={(e) => e.target.select()} onKeyDown={(e) => e.key === "Enter" && addNewSection()} style={{ height: 44, fontSize: 15 }} />
            </label>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 12, borderTop: "1px solid var(--line)", flexWrap: "wrap" }}>
            {tab !== "pad" && (
              <>
                <span style={{ fontSize: 13, color: "var(--dim)" }}>{tab === "section" ? t("add.after") : t("add.to")}</span>
                <select className="select" aria-label={t("add.to")} value={shownWhere} onChange={(e) => setWhere(e.target.value)} style={{ maxWidth: 320 }}>
                  {whereOptions(t, tab === "section").map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </>
            )}
            <span style={{ flex: 1 }} />
            <button className="b btn btn-ghost" onClick={() => useUi.getState().openDialog({ kind: "settings", tab: "tools" })}>{t("add.importSettings")}</button>
            {(tab === "files" || tab === "pad") && <button className="b btn btn-go" onClick={() => void choose()}>{t("add.choose")}</button>}
            {tab === "section" && <button className="b btn btn-go" onClick={addNewSection}>{t("add.addSection")}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- "Add to" choices, encoded as text for the <select>: "after:<cueId>" or "end:<sectionId>" ----

function defaultWhere(): string {
  const after = lastSelected();
  if (after) return `after:${after}`;
  const secs = useDoc.getState().show.sections;
  return secs.length ? `end:${secs[secs.length - 1].id}` : "end:";
}

function toTarget(where: string): AddTarget {
  const [kind, id] = where.split(":");
  return kind === "after" ? { afterId: id } : { afterId: null, sectionId: id || undefined };
}

function whereOptions(t: (k: TKey) => string, sectionsOnly: boolean): { value: string; label: string }[] {
  const s = useDoc.getState();
  const after = lastSelected();
  const cue = findCue(s.show, after);
  const opts: { value: string; label: string }[] = [];
  if (cue && after && !sectionsOnly) {
    const sec = locate(s.show, after)?.section.name ?? "";
    opts.push({ value: `after:${after}`, label: `${t("add.afterCue")} ${cue.number} · ${sec}` });
  }
  for (const sec of s.show.sections) opts.push({ value: `end:${sec.id}`, label: sectionsOnly ? sec.name : `${t("add.endOf")} ${sec.name}` });
  return opts;
}
