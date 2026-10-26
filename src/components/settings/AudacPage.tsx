// Settings › AUDAC: where the school's MTX88 is on the network, and what its zones and inputs are
// called here (e.g. input 4 = "Streambox", zone 3 = "Study hall"). Remembered on this laptop.
// Everyone sees the status and can connect / let go; everything else needs the admin password.

import { useState } from "react";
import { useSettings, type AudacSetup } from "../../settingsStore";
import { useT } from "../../i18n";
import { audac, audacConnectSaved, useAudac } from "../../lib/audac";
import { Chips, Row } from "../controls";
import { Card, PageTitle } from "./common";
import { AdminGate } from "./AdminGate";

export function AudacPage() {
  const t = useT();
  const setup = useSettings((s) => s.ui.audac);
  const update = useSettings((s) => s.update);
  const st = useAudac();
  const [host, setHost] = useState(setup.host);
  const save = (patch: Partial<AudacSetup>) => update({ audac: { ...useSettings.getState().ui.audac, ...patch } });
  const connected = st?.status === "connected";

  return (
    <>
      <PageTitle note={t("set.storedLaptop")}>AUDAC</PageTitle>
      {/* Anyone: see the status, connect, let go. */}
      <Card title={t("audac.where")} note={t("audac.oneConnection")}>
        <Row label={t("audac.status")}>
          <span style={{ fontSize: 13, color: connected ? "var(--acc)" : st?.status === "retrying" ? "var(--ambtx)" : "var(--dim)", flex: 1 }}>
            {connected ? `${t("audac.connected")} ${st!.host}` : st?.status === "retrying" ? st.message : st?.status === "connecting" ? t("audac.connecting") : t("audac.off")}
          </span>
          {st?.status === "off" || !st ? (
            <button className="b btn btn-go" disabled={!setup.host.trim()} onClick={audacConnectSaved}>{t("audac.connect")}</button>
          ) : (
            <button className="b btn" onClick={() => void audac.disconnect()}>{t("audac.release")}</button>
          )}
        </Row>
      </Card>
      {/* Admin only: where the MTX is, how StageGremlin behaves, and the zone and input names. */}
      <AdminGate>
      <Card title={t("audac.setupTitle")}>
        <Row label={t("audac.ip")}>
          <input className="input mono" aria-label={t("audac.ip")} placeholder="192.168.1.50" value={host}
            onChange={(e) => setHost(e.target.value)} onBlur={() => save({ host: host.trim() })} style={{ width: 180 }} />
          <input className="input mono" aria-label="Port" value={setup.port} inputMode="numeric"
            onChange={(e) => save({ port: Number(e.target.value.replace(/\D/g, "")) || 5001 })} style={{ width: 70 }} title="Port (5001 on the MTX)" />
        </Row>
        <Row label={t("audac.atStart")}>
          <button className="b chip" aria-pressed={setup.autoConnect} onClick={() => save({ autoConnect: !setup.autoConnect })}>
            {setup.autoConnect ? t("audac.autoOn") : t("audac.autoOff")}
          </button>
        </Row>
        <Row label={t("audac.inRun")} hint={t("audac.inRunHint")}>
          <Chips<AudacSetup["inRun"]> label={t("audac.inRun")} value={setup.inRun} onChange={(inRun) => save({ inRun })}
            options={[{ value: "show", label: t("audac.runShow") }, { value: "locked", label: t("audac.runLocked") }, { value: "hide", label: t("audac.runHide") }]} />
        </Row>
      </Card>
      <Names title={t("audac.inputs")} note={t("audac.inputsNote")} list={setup.inputs} onChange={(inputs) => save({ inputs })} />
      <Names title={t("audac.zones")} note={t("audac.zonesNote")} list={setup.zones} onChange={(zones) => save({ zones })} />
      </AdminGate>
    </>
  );
}

/** Eight rows: show it or not, and its name here. */
function Names({ title, note, list, onChange }: { title: string; note: string; list: AudacSetup["zones"]; onChange: (l: AudacSetup["zones"]) => void }) {
  const set = (i: number, patch: Partial<AudacSetup["zones"][number]>) => onChange(list.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <Card title={title} note={note}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
        {list.map((x, i) => (
          <label key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={x.show} onChange={(e) => set(i, { show: e.target.checked })} style={{ width: 18, height: 18 }} />
            <span className="mono" style={{ width: 16, color: "var(--mute)" }}>{i + 1}</span>
            <input className="input" value={x.name} onChange={(e) => set(i, { name: e.target.value })} style={{ flex: 1, minWidth: 0, opacity: x.show ? 1 : 0.5 }} />
          </label>
        ))}
      </div>
    </Card>
  );
}
