// Settings › AUDAC: where the school's MTX88 is on the network, and what its zones and inputs are
// called here (e.g. input 4 = "Streambox", zone 3 = "Study hall"). Remembered on this laptop.
// Anyone can set up and use the connection; naming zones and inputs and choosing which show needs the admin password.

import { useEffect, useState } from "react";
import { useSettings, type AudacSetup } from "../../settingsStore";
import { useT } from "../../i18n";
import { audac, audacConnectSaved, findZone, setAudacDemo, useAudac, type AudacState, type AudacTalk } from "../../lib/audac";
import type { AudacGroup } from "../../settingsStore";
import { applyMtxNames, DEFAULT_INPUT_NAMES, DEFAULT_ZONE_NAMES, mtxNames } from "../../lib/audacNames";
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
      {/* Anyone: the connection and how StageGremlin uses it. */}
      <Card title={t("audac.where")} note={t("audac.oneConnection")}>
        <Row label={t("audac.status")}>
          <span style={{ fontSize: 13, color: connected ? "var(--acc)" : st?.status === "retrying" ? "var(--ambtx)" : "var(--dim)", flex: 1 }}>
            {connected ? `${t("audac.connected")} ${st!.host}` : st?.status === "retrying" ? st.message : st?.status === "connecting" ? t("audac.connecting") : t("audac.off")}
          </span>
          {st?.status === "off" || !st ? (
            <button className="b btn btn-go" disabled={!host.trim() && !setup.demo} onClick={() => { save({ host: host.trim() }); setTimeout(audacConnectSaved, 0); }}>{t("audac.connect")}</button>
          ) : (
            <button className="b btn" onClick={() => void audac.disconnect()}>{t("audac.release")}</button>
          )}
        </Row>
        <Row label={t("audac.ip")}>
          <input className="input mono" aria-label={t("audac.ip")} placeholder="192.168.1.50" value={host} disabled={setup.demo}
            onChange={(e) => setHost(e.target.value)} onBlur={() => save({ host: host.trim() })} style={{ width: 180 }} />
          <input className="input mono" aria-label="Port" value={setup.port} inputMode="numeric" disabled={setup.demo}
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
        <Row label={t("audac.demo")} hint={t("audac.demoHint")}>
          <button className="b chip" aria-pressed={setup.demo} onClick={() => void setAudacDemo(!setup.demo)}>
            {setup.demo ? t("audac.demoOn") : t("audac.demoOff")}
          </button>
        </Row>
      </Card>
      <GuardCard />
      {/* Admin only: the zone and input names, which of them show, and the groups. */}
      <AdminGate>
      <MtxNamesCard st={st} />
      <FindCard st={st} />
      <Names title={t("audac.inputs")} note={t("audac.inputsNote")} list={setup.inputs} onChange={(inputs) => save({ inputs })} />
      <Names title={t("audac.zones")} note={t("audac.zonesNote")} list={setup.zones} onChange={(zones) => save({ zones })} />
      <GroupsCard />
      <TalkCard />
      </AdminGate>
    </>
  );
}

const saveAudac = (patch: Partial<AudacSetup>) => useSettings.getState().update({ audac: { ...useSettings.getState().ui.audac, ...patch } });

/** Zone tick chips 1–8 with their names. */
function ZonePicker({ value, onChange, label }: { value: number[]; onChange: (z: number[]) => void; label: string }) {
  const zones = useSettings((s) => s.ui.audac.zones);
  return (
    <div role="group" aria-label={label} style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {zones.map((z, i) => {
        const n = i + 1, on = value.includes(n);
        return (
          <button key={n} className="b chip" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== n) : [...value, n].sort((a, b) => a - b))}
            style={{ height: 28, fontSize: 12, padding: "0 8px" }}>
            {n} {z.name}
          </button>
        );
      })}
    </div>
  );
}

/** Guard: which zones StageGremlin puts back when someone else changes them, and when. */
function GuardCard() {
  const t = useT();
  const guard = useSettings((s) => s.ui.audac.guard) ?? { zones: [], when: "off" as const };
  return (
    <Card title={t("audac.guard")} note={t("audac.guardNote")}>
      <Row label={t("audac.guardWhen")}>
        <Chips<"off" | "run" | "always"> label={t("audac.guardWhen")} value={guard.when} onChange={(when) => saveAudac({ guard: { ...guard, when } })}
          options={[{ value: "off", label: t("audac.guardOff") }, { value: "run", label: t("audac.guardRun") }, { value: "always", label: t("audac.guardAlways") }]} />
      </Row>
      <ZonePicker label={t("audac.guard")} value={guard.zones} onChange={(zones) => saveAudac({ guard: { ...guard, zones } })} />
      <Row label={t("audac.strength")}>
        <Chips<"polite" | "hold"> label={t("audac.strength")} value={guard.strength ?? "polite"} onChange={(strength) => saveAudac({ guard: { ...guard, strength } })}
          options={[{ value: "polite", label: t("audac.polite") }, { value: "hold", label: t("audac.holdLong") }]} />
      </Row>
    </Card>
  );
}

/** Groups: named sets of zones that get one row in the AUDAC panel. */
function GroupsCard() {
  const t = useT();
  const groups = useSettings((s) => s.ui.audac.groups) ?? [];
  const put = (list: AudacGroup[]) => saveAudac({ groups: list });
  const change = (id: string, patch: Partial<AudacGroup>) => put(groups.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  return (
    <Card title={t("audac.groups")} note={t("audac.groupsNote")}>
      {groups.map((g) => (
        <div key={g.id} style={{ display: "flex", flexDirection: "column", gap: 6, padding: 8, borderRadius: 10, background: "var(--p2)" }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="input" aria-label={t("audac.groups")} value={g.name} placeholder={t("audac.newGroup")} onChange={(e) => change(g.id, { name: e.target.value })} style={{ flex: 1 }} />
            <button className="b btn btn-ghost" onClick={() => put(groups.filter((x) => x.id !== g.id))}>{t("audac.delete")}</button>
          </div>
          <ZonePicker label={g.name} value={g.zones} onChange={(zones) => change(g.id, { zones })} />
        </div>
      ))}
      <div>
        <button className="b btn" onClick={() => put([...groups, { id: `g${Date.now().toString(36)}`, name: "", zones: [] }])}>{t("audac.addGroup")}</button>
      </div>
    </Card>
  );
}

/** Which is which: blink a zone, or play an input on a test zone. */
function FindCard({ st }: { st: AudacState | null }) {
  const t = useT();
  const setup = useSettings((s) => s.ui.audac);
  const [testZone, setTestZone] = useState(1);
  const live = st?.status === "connected" && st.known;
  return (
    <Card title={t("audac.findTitle")} note={t("audac.findNote")}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6 }}>
        {setup.zones.map((z, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="mono" style={{ width: 16, color: "var(--mute)" }}>{i + 1}</span>
            <span className="clamp1" style={{ flex: 1 }}>{z.name}</span>
            <button className="b btn" disabled={!live} onClick={() => findZone(i + 1, !!st?.zones[i]?.mute)}>{t("audac.find")}</button>
          </div>
        ))}
      </div>
      <Row label={t("audac.testZone")}>
        <select className="select" aria-label={t("audac.testZone")} value={testZone} onChange={(e) => setTestZone(Number(e.target.value))} style={{ flex: 1, height: 34 }}>
          {setup.zones.map((z, i) => <option key={i} value={i + 1}>{i + 1} {z.name}</option>)}
        </select>
      </Row>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6 }}>
        {setup.inputs.map((x, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="mono" style={{ width: 16, color: "var(--mute)" }}>{i + 1}</span>
            <span className="clamp1" style={{ flex: 1 }}>{x.name}</span>
            <button className="b btn" disabled={!live} aria-pressed={st?.zones[testZone - 1]?.input === i + 1}
              onClick={() => { void audac.setMute(testZone, false); void audac.setInput(testZone, i + 1); }}>{t("audac.try")}</button>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** What StageGremlin and the MTX say to each other, to find out what the box really answers. */
function TalkCard() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<AudacTalk | null>(null);
  const lines = report?.lines ?? [];
  useEffect(() => {
    if (!open) return;
    const get = () => audac.talk().then(setReport, () => {});
    get();
    const id = setInterval(get, 1000);
    return () => clearInterval(id);
  }, [open]);
  return (
    <Card title={t("audac.talk")} note={t("audac.talkNote")}>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="b btn" aria-pressed={open} onClick={() => setOpen(!open)}>{open ? t("audac.talkHide") : t("audac.talkShow")}</button>
        {open && <button className="b btn" onClick={() => void navigator.clipboard?.writeText(lines.join("\n"))}>{t("audac.talkCopy")}</button>}
      </div>
      {open && report && (
        <div style={{ fontSize: 13, display: "flex", flexDirection: "column", gap: 2 }}>
          <b>{t("audac.others")}</b>
          {report.others.length ? report.others.map((o) => (
            <span key={o.name} className="mono">{o.name} · {Math.round(o.agoMs / 1000)} s {t("audac.ago")} · {o.lines} {t("audac.linesWord")}</span>
          )) : <span style={{ color: "var(--dim)" }}>{t("audac.othersNone")}</span>}
          <span style={{ color: "var(--mute)", fontSize: 12 }}>{t("audac.othersNote")} {report.vuLines ? `(${report.vuLines} VU)` : ""}</span>
        </div>
      )}
      {open && (
        <pre className="mono scroll" style={{ maxHeight: 300, margin: 0, padding: 8, borderRadius: 8, background: "var(--p2)", fontSize: 11.5, whiteSpace: "pre-wrap", userSelect: "text" }}>
          {lines.slice(-120).join("\n") || "…"}
        </pre>
      )}
    </Card>
  );
}

/** The names stored on the MTX: shown, and one button to use them all here. */
function MtxNamesCard({ st }: { st: AudacState | null }) {
  const t = useT();
  const got = mtxNames(st?.names);
  const connected = st?.status === "connected";
  const use = () => {
    if (!got) return;
    const a = useSettings.getState().ui.audac;
    useSettings.getState().update({ audac: { ...a,
      zones: applyMtxNames(a.zones, got.zones, DEFAULT_ZONE_NAMES, false),
      inputs: applyMtxNames(a.inputs, got.inputs, DEFAULT_INPUT_NAMES, false) } });
  };
  return (
    <Card title={t("audac.mtxNames")} note={t("audac.mtxNamesNote")}>
      {got ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
          <span><b>{t("audac.zones")}:</b> {got.zones.map((z, i) => `${i + 1} ${z || "—"}`).join(" · ")}</span>
          <span><b>{t("audac.inputs")}:</b> {got.inputs.map((z, i) => `${i + 1} ${z || "—"}`).join(" · ")}</span>
          <div><button className="b btn" onClick={use}>{t("audac.useMtxNames")}</button></div>
        </div>
      ) : (
        <span style={{ fontSize: 13, color: "var(--dim)" }}>
          {!connected ? t("audac.mtxNamesNone") : st?.namesAnswered ? t("audac.mtxNamesEmpty") : t("audac.mtxNamesNoAnswer")}
        </span>
      )}
    </Card>
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
