// A quiet bar under the top bar when a newer build is on GitHub. Build and Preflight only: never
// during a show. "Download" opens the release page; "Later" hides it until the app restarts.

import { useDoc } from "../store";
import { buildLabel, openReleasePage, useUpdates } from "../lib/updates";
import { useT } from "../i18n";

export function UpdateBanner() {
  const t = useT();
  const mode = useDoc((s) => s.mode);
  const info = useUpdates((s) => s.info);
  const dismissed = useUpdates((s) => s.dismissed);
  if (mode === "run" || !info?.newer || !info.url || dismissed === info.latest) return null;
  return (
    <div role="status" style={{ flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "6px 18px", background: "var(--cybg)", color: "var(--cytx)", borderBottom: "1px solid var(--cyline)", fontSize: 13.5 }}>
      <span style={{ flex: 1 }}>
        <b>{t("upd.available")} {buildLabel(info.latest)}</b> · {t("upd.youHave")} {buildLabel(info.current)}. {t("upd.between")}
      </span>
      <button className="b btn" onClick={() => openReleasePage(info.url!)} style={{ height: 30, background: "var(--cy)", color: "var(--oncy)", fontWeight: 700 }}>{t("upd.download")}</button>
      <button className="b btn btn-ghost" onClick={() => useUpdates.getState().dismiss()} style={{ height: 30, color: "var(--cytx)" }}>{t("upd.later")}</button>
    </div>
  );
}
