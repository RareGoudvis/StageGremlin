// Taking this laptop's settings along: to a new build, a backup file, or another laptop.
// A fresh copy of StageGremlin brings the last-used settings over by itself (src-tauri settings.rs,
// carry_over); this file adds the Export / Import buttons and the one-time "brought over" message.

import { call, isTauri } from "./tauri";
import { useSettings } from "../settingsStore";
import { useUi } from "../uiStore";
import { translate, type TKey } from "../i18n";

const tr = (key: TKey) => translate(useSettings.getState().ui.lang, key);

// A function, so the file type name follows the language at the moment the dialog opens.
const filter = () => [{ name: tr("m.settingsFile"), extensions: ["json"] }];

/** Once at start: say so when the settings came from an older copy. */
export async function tellCarriedOver() {
  if (!isTauri) return;
  try {
    const info = await call("app_info");
    if (info.carriedFrom) useUi.getState().showToast(tr("set.carried"));
  } catch {
    // not important enough to bother anyone
  }
}

export async function exportSettings() {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({ defaultPath: "StageGremlin-settings.json", filters: filter() });
  if (!path) return;
  try {
    await call("settings_export", { path });
    useUi.getState().showToast(tr("set.exported"));
  } catch (e) {
    useUi.getState().showToast(String(e));
  }
}

export async function importSettings() {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const path = await open({ multiple: false, filters: filter() });
  if (!path || Array.isArray(path)) return;
  try {
    await call("settings_import", { path });
    await useSettings.getState().load();
    useUi.getState().showToast(tr("set.imported"));
  } catch (e) {
    useUi.getState().showToast(String(e));
  }
}
