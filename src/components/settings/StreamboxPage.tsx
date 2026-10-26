// Settings › Streambox: which network player feeds the AUDAC (the school's Pro-Ject Stream Box S2 Ultra),
// found by searching the Wi-Fi network. The search shows what each device speaks (Google Cast, AirPlay,
// Spotify Connect, DLNA); that decides what StageGremlin can do with it next. Remembered on this laptop.

import { useState } from "react";
import { useSettings, type StreamboxSetup } from "../../settingsStore";
import { useT } from "../../i18n";
import { call, isTauri } from "../../lib/tauri";
import { visible } from "../../lib/audac";
import { Row } from "../controls";
import { Card, PageTitle } from "./common";

interface Found { ip: string; name: string; model: string | null; kinds: string[] }

/** What we know about each model. Only the S2 Ultra is checked against its spec sheets. */
export const STREAMBOX_MODELS: { id: string; label: string; kinds: string; checked: boolean }[] = [
  { id: "s2ultra", label: "Pro-Ject Stream Box S2 Ultra", kinds: "AirPlay, DLNA/UPnP, Roon Ready, Spotify/TIDAL/Qobuz built in", checked: true },
  { id: "projectOther", label: "Other Pro-Ject Stream Box", kinds: "probably AirPlay and DLNA", checked: false },
  { id: "other", label: "Other network player", kinds: "whatever the search finds", checked: false },
];

export function StreamboxPage() {
  const t = useT();
  const box = useSettings((s) => s.ui.streambox);
  const audacInputs = useSettings((s) => s.ui.audac.inputs);
  const update = useSettings((s) => s.update);
  const save = (patch: Partial<StreamboxSetup>) => update({ streambox: { ...useSettings.getState().ui.streambox, ...patch } });
  const [found, setFound] = useState<Found[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const model = STREAMBOX_MODELS.find((m) => m.id === box.model) ?? STREAMBOX_MODELS[0];

  const search = async () => {
    setSearching(true);
    setError(null);
    try {
      setFound(isTauri ? await call("net_discover") : DEMO_FOUND);
    } catch (e) {
      setError(String(e));
    } finally {
      setSearching(false);
    }
  };

  return (
    <>
      <PageTitle note={t("set.storedLaptop")}>{t("set.streambox")}</PageTitle>
      <Card title={t("sbx.model")} note={model.checked ? `${t("sbx.speaks")}: ${model.kinds}.` : `${model.kinds} (${t("sbx.notChecked")}).`}>
        <select className="select" aria-label={t("sbx.model")} value={box.model} onChange={(e) => save({ model: e.target.value })} style={{ maxWidth: 360 }}>
          {STREAMBOX_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </Card>

      <Card title={t("sbx.which")} note={t("sbx.whichNote")}>
        {box.ip ? (
          <Row label={t("sbx.chosen")}>
            <span style={{ flex: 1, fontSize: 14 }}>
              <b>{box.name}</b> <span className="mono" style={{ color: "var(--dim)" }}>{box.ip}</span>
              {box.kinds.length > 0 && <span style={{ color: "var(--dim)" }}> · {box.kinds.join(", ")}</span>}
            </span>
            <button className="b btn btn-ghost" onClick={() => save({ ip: "", name: "", kinds: [] })}>{t("sbx.forget")}</button>
          </Row>
        ) : (
          <span style={{ fontSize: 13, color: "var(--dim)" }}>{t("sbx.noneYet")}</span>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="b btn btn-go" disabled={searching} onClick={() => void search()}>{searching ? t("sbx.searching") : t("sbx.search")}</button>
          {error && <span style={{ fontSize: 12.5, color: "var(--redtx)" }}>{error}</span>}
        </div>
        {found && (
          <div style={{ display: "flex", flexDirection: "column", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
            {found.length === 0 && <span style={{ padding: 12, fontSize: 13, color: "var(--dim)" }}>{t("sbx.nothingFound")}</span>}
            {found.map((f, i) => (
              <div key={f.ip} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderTop: i ? "1px solid var(--line)" : "none", background: f.ip === box.ip ? "var(--p2)" : "transparent" }}>
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                  <span className="clamp1" style={{ fontSize: 14, fontWeight: 700 }}>{f.name || f.ip}</span>
                  <span className="mono" style={{ fontSize: 11.5, color: "var(--mute)" }}>{f.ip}{f.model ? ` · ${f.model}` : ""}</span>
                </span>
                {f.kinds.map((k) => <span key={k} className="tag">{k}</span>)}
                <button className="b btn" disabled={f.ip === box.ip} onClick={() => save({ ip: f.ip, name: f.name || f.ip, kinds: f.kinds })}>{t("sbx.thisOne")}</button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title={t("sbx.onAudac")} note={t("sbx.onAudacNote")}>
        <select className="select" aria-label={t("sbx.onAudac")} value={box.audacInput} onChange={(e) => save({ audacInput: Number(e.target.value) })} style={{ maxWidth: 260 }}>
          <option value={0}>{t("sbx.notSet")}</option>
          {visible(audacInputs).map((i) => <option key={i.n} value={i.n}>{i.n} · {i.name}</option>)}
        </select>
      </Card>
    </>
  );
}

// The browser preview can't search a network; it shows what a school network might look like.
const DEMO_FOUND: Found[] = [
  { ip: "10.0.0.41", name: "Stream Box S2 Ultra", model: "Pro-Ject Stream Box S2 Ultra", kinds: ["Google Cast", "DLNA"] },
  { ip: "10.0.0.17", name: "Lerarenkamer TV", model: null, kinds: ["AirPlay"] },
];
