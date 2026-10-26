// Shown instead of the toolbar while two or more cues are selected, so it is obvious that
// what you do next applies to all of them. The inspector on the right edits them together too.

import { useDoc } from "../../store";
import { duplicateCues } from "../../lib/clipboard";
import { moveToSectionMenu, selectionColourMenu } from "../../lib/menus";
import { useT } from "../../i18n";
import { toggleMenuBelow } from "../ContextMenu";
import { Caret, Close } from "../Icons";
import { deleteCues } from "./Inspector";

export function SelectionBar() {
  const t = useT();
  const selection = useDoc((s) => s.selection);
  // The bar is always dark (in light and black themes), like the mockup: it must stand out.
  const btn = { height: 36, padding: "0 12px", border: "1px solid #3A3C33", borderRadius: 8, background: "transparent", color: "#F4F3EE", fontSize: 13, fontWeight: 600 };
  return (
    <div style={{ height: 64, flex: "none", display: "flex", alignItems: "center", gap: 10, padding: "0 16px", background: "#17180F", color: "#F4F3EE", borderBottom: "1px solid #17180F" }}>
      <span style={{ fontSize: 14, fontWeight: 700 }}>{selection.length} {t("sel.selected")}</span>
      <span style={{ color: "#A6A99C", fontSize: 13 }}>{t("sel.applies")}</span>
      <span style={{ flex: 1 }} />
      <button className="b" data-menu style={btn} onClick={(e) => toggleMenuBelow(e.currentTarget, selectionColourMenu(selection))}>
        {t("sel.colour")} <Caret size={12} />
      </button>
      <button className="b" data-menu style={btn} onClick={(e) => toggleMenuBelow(e.currentTarget, moveToSectionMenu(selection))}>
        {t("sel.move")} <Caret size={12} />
      </button>
      <button className="b" style={btn} onClick={duplicateCues}>{t("sel.duplicate")}</button>
      <button className="b" style={{ ...btn, borderColor: "#7A2A22", color: "#FFB4AA" }} onClick={() => void deleteCues(selection)}>{t("sel.delete")}</button>
      <button className="b" aria-label={t("sel.clear")} title={`${t("sel.clear")} · Esc`} onClick={() => useDoc.getState().setSelection([])}
        style={{ width: 36, height: 36, borderRadius: 8, background: "#2A2C24", color: "#F4F3EE", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Close />
      </button>
    </div>
  );
}
