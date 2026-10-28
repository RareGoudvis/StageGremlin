// Build's left rail. Media opens or folds the media sidebar (you import first, then use);
// Cues and Pads swap the middle of the screen. The inspector on the right stays.

import { useDoc } from "../../store";
import { useUi } from "../../uiStore";
import { useT } from "../../i18n";
import { FolderIcon, ListIcon, PadsIcon } from "../Icons";

export function BuildRail() {
  const t = useT();
  const tab = useDoc((s) => s.buildTab);
  const padCount = useDoc((s) => s.show.pads.length);
  const binOpen = useUi((s) => s.binOpen);
  const item = (on: boolean) => ({
    width: 60, height: 58, borderRadius: 12, display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center", gap: 4,
    background: on ? "var(--hl)" : "transparent", color: on ? "var(--bg)" : "var(--dim)",
  });
  const label = { fontSize: 11, fontWeight: 700, letterSpacing: ".04em" };
  return (
    <nav aria-label={t("b.rail.aria")} style={{ width: 76, flex: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "14px 0", borderRight: "1px solid var(--line)", background: "var(--p1)" }}>
      <button className="b" aria-pressed={binOpen} onClick={() => useUi.getState().setBinOpen(!binOpen)} title={t("rail.mediaHint")} style={item(binOpen)}>
        <FolderIcon /><span style={label}>{t("rail.media")}</span>
      </button>
      <span aria-hidden="true" style={{ width: 36, height: 1, background: "var(--line)", margin: "4px 0" }} />
      <button className="b" aria-pressed={tab === "cues"} onClick={() => useDoc.getState().setBuildTab("cues")} style={item(tab === "cues")}>
        <ListIcon /><span style={label}>{t("rail.cues")}</span>
      </button>
      <button className="b" aria-pressed={tab === "pads"} onClick={() => useDoc.getState().setBuildTab("pads")} title={`${t("rail.pads")} · ${padCount}`} style={item(tab === "pads")}>
        <PadsIcon /><span style={label}>{t("rail.pads")}</span>
      </button>
    </nav>
  );
}
