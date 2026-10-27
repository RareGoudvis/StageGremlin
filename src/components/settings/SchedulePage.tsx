// Settings › Schedule: times when StageGremlin runs the AUDAC zones (and background music) by itself,
// e.g. lunch in the study hall. Admin only. The runner is lib/audacSchedule.ts.

import { volumeFor } from "../../lib/audacGroups";
import { useSettings, type AudacSetup, type ScheduleEntry } from "../../settingsStore";
import { useT, type TKey } from "../../i18n";
import { MIN_VOLUME, visible } from "../../lib/audac";
import { nextStart } from "../../lib/audacSchedule";
import { useEnabledSources } from "../background/useBackground";
import { newId } from "../../types";
import { Chips, Row } from "../controls";
import { Card, PageTitle } from "./common";
import { AdminGate } from "./AdminGate";

/** Monday first, as on a school timetable. Values are JavaScript's getDay (0 = Sunday). */
const DAYS: { d: number; label: TKey }[] = [
  { d: 1, label: "day.mo" }, { d: 2, label: "day.tu" }, { d: 3, label: "day.we" }, { d: 4, label: "day.th" },
  { d: 5, label: "day.fr" }, { d: 6, label: "day.sa" }, { d: 0, label: "day.su" },
];

export function SchedulePage() {
  const t = useT();
  const setup = useSettings((s) => s.ui.audac);
  const update = useSettings((s) => s.update);
  const save = (patch: Partial<AudacSetup>) => update({ audac: { ...useSettings.getState().ui.audac, ...patch } });
  const setEntry = (id: string, patch: Partial<ScheduleEntry>) =>
    save({ schedule: useSettings.getState().ui.audac.schedule.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
  const add = () => {
    const firstZone = visible(setup.zones)[0]?.n ?? 1;
    const firstInput = visible(setup.inputs)[0]?.n ?? 1;
    save({
      schedule: [...setup.schedule, {
        id: newId(), name: t("sched.newName"), on: true, days: [1, 2, 3, 4, 5], from: "12:15", to: "13:00",
        zones: [firstZone], input: firstInput, volume: 24, music: { source: "", link: "" },
      }],
    });
  };

  return (
    <>
      <PageTitle note={t("sched.onlyOpen")}>{t("set.schedule")}</PageTitle>
      {!setup.host.trim() && <span style={{ fontSize: 13, color: "var(--ambtx)" }}>{t("audac.notSetUp")}</span>}
      <AdminGate>
        <Card title={t("sched.duringShow")}>
          <Row label={t("sched.inRun")}>
            <Chips<boolean> label={t("sched.inRun")} value={setup.schedulePauseInRun} onChange={(schedulePauseInRun) => save({ schedulePauseInRun })}
              options={[{ value: true, label: t("sched.pauseInRun") }, { value: false, label: t("sched.runInRun") }]} />
          </Row>
          <Row label={t("sched.after")}>
            <Chips<AudacSetup["scheduleAfter"]> label={t("sched.after")} value={setup.scheduleAfter} onChange={(scheduleAfter) => save({ scheduleAfter })}
              options={[{ value: "release", label: t("sched.release") }, { value: "keep", label: t("sched.keep") }]} />
          </Row>
        </Card>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ flex: 1, fontSize: 13, color: "var(--dim)" }}>{t("sched.explain")}</span>
          <button className="b btn btn-go" onClick={add}>+ {t("sched.add")}</button>
        </div>
        {setup.schedule.map((e) => (
          <EntryCard key={e.id} e={e} setup={setup} set={(patch) => setEntry(e.id, patch)}
            remove={() => save({ schedule: setup.schedule.filter((x) => x.id !== e.id) })} />
        ))}
      </AdminGate>
    </>
  );
}

function EntryCard({ e, setup, set, remove }: { e: ScheduleEntry; setup: AudacSetup; set: (p: Partial<ScheduleEntry>) => void; remove: () => void }) {
  const t = useT();
  const sources = useEnabledSources();
  const next = nextStart(e, new Date());
  const badTimes = e.to <= e.from;
  const toggle = (list: number[], n: number) => (list.includes(n) ? list.filter((x) => x !== n) : [...list, n]);

  return (
    <section style={{ background: "var(--p1)", border: "1px solid var(--line)", borderRadius: 14, padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12, opacity: e.on ? 1 : 0.7 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button className="b chip" aria-pressed={e.on} onClick={() => set({ on: !e.on })} style={{ width: 56, justifyContent: "center" }}>{e.on ? "ON" : "OFF"}</button>
        <input className="input" aria-label={t("sched.name")} value={e.name} onChange={(ev) => set({ name: ev.target.value })} style={{ flex: 1, fontSize: 16, fontWeight: 700 }} />
        <input className="input mono" type="time" aria-label={t("sched.from")} value={e.from} onChange={(ev) => set({ from: ev.target.value })} style={{ width: 110 }} />
        <span aria-hidden="true">→</span>
        <input className="input mono" type="time" aria-label={t("sched.to")} value={e.to} onChange={(ev) => set({ to: ev.target.value })} style={{ width: 110 }} />
        <button className="b btn btn-danger" onClick={remove}>{t("sched.delete")}</button>
      </div>
      {badTimes && <span style={{ fontSize: 12.5, color: "var(--redtx)" }}>{t("sched.badTimes")}</span>}

      <Row label={t("sched.days")}>
        {DAYS.map((x) => (
          <button key={x.d} className="b chip" aria-pressed={e.days.includes(x.d)} onClick={() => set({ days: toggle(e.days, x.d) })} style={{ width: 44, justifyContent: "center" }}>
            {t(x.label)}
          </button>
        ))}
      </Row>
      <Row label={t("audac.zones")}>
        {visible(setup.zones).map((z) => (
          <button key={z.n} className="b chip" aria-pressed={e.zones.includes(z.n)} onClick={() => set({ zones: toggle(e.zones, z.n) })}>{z.name}</button>
        ))}
      </Row>
      <Row label={t("sched.input")}>
        {visible(setup.inputs).map((i) => (
          <button key={i.n} className="b chip" aria-pressed={e.input === i.n} onClick={() => set({ input: i.n })}>{i.name}</button>
        ))}
      </Row>
      <Row label={t("sched.level")}>
        {/* Right = louder, like the panel. */}
        <input type="range" aria-label={t("sched.level")} min={0} max={MIN_VOLUME} value={MIN_VOLUME - e.volume} disabled={!!e.zoneVolumes}
          onChange={(ev) => set({ volume: MIN_VOLUME - Number(ev.target.value) })} style={{ flex: 1 }} />
        <span className="mono" style={{ width: 64, textAlign: "right" }}>−{e.volume} dB</span>
        <button className="b chip" aria-pressed={!!e.zoneVolumes} title={t("sched.advancedHint")}
          onClick={() => set({ zoneVolumes: e.zoneVolumes ? undefined : Object.fromEntries(e.zones.map((z) => [String(z), e.volume])) })}>
          {t("sched.advanced")}
        </button>
      </Row>
      {e.zoneVolumes && e.zones.map((z) => {
        const v = volumeFor(e, z);
        return (
          <Row key={z} label={setup.zones[z - 1]?.name || `Zone ${z}`}>
            <input type="range" aria-label={`${setup.zones[z - 1]?.name || z} ${t("sched.level")}`} min={0} max={MIN_VOLUME} value={MIN_VOLUME - v}
              onChange={(ev) => set({ zoneVolumes: { ...e.zoneVolumes, [String(z)]: MIN_VOLUME - Number(ev.target.value) } })} style={{ flex: 1 }} />
            <span className="mono" style={{ width: 64, textAlign: "right" }}>−{v} dB</span>
          </Row>
        );
      })}
      <Row label={t("sched.protect")} hint={t("sched.protectHint")}>
        <Chips<NonNullable<ScheduleEntry["protect"]>> label={t("sched.protect")} value={e.protect ?? "noLouder"} onChange={(protect) => set({ protect })}
          options={[{ value: "noLouder", label: t("sched.protectNoLouder") }, { value: "full", label: t("sched.protectFull") }, { value: "off", label: t("sched.protectOff") }]} />
      </Row>
      <Row label={t("sched.music")} hint={t("sched.musicHint")}>
        <select className="select" aria-label={t("sched.music")} value={e.music.source} onChange={(ev) => set({ music: { ...e.music, source: ev.target.value as ScheduleEntry["music"]["source"] } })} style={{ width: 170 }}>
          <option value="">{t("sched.noMusic")}</option>
          {sources.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        {e.music.source && (
          <input className="input mono" aria-label={t("sched.link")} placeholder={t("sched.link")} value={e.music.link}
            onChange={(ev) => set({ music: { ...e.music, link: ev.target.value } })} style={{ flex: 1, minWidth: 0, fontSize: 12.5 }} />
        )}
      </Row>
      <span style={{ fontSize: 12.5, color: "var(--mute)", borderTop: "1px dashed var(--line)", paddingTop: 8 }}>
        {next ? `${t("sched.next")} ${next.toLocaleString(undefined, { weekday: "long", hour: "2-digit", minute: "2-digit" })}` : t("sched.never")}
      </span>
    </section>
  );
}
