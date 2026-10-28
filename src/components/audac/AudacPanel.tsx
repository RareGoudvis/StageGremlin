// The AUDAC remote: one row per zone with its input (aux, streambox, mic…), volume and mute.
// Used in Run's dock (AUDAC tab) and in the window behind the top bar's AUDAC button.
// Buttons never take keyboard focus (tabIndex -1): in Run, Space must stay GO.

import { useEffect, useState } from "react";
import { create } from "zustand";
import { useSettings } from "../../settingsStore";
import { useUi } from "../../uiStore";
import { audac, audacConnectSaved, MIN_VOLUME, otherAppName, useAudac, visible, type AudacState } from "../../lib/audac";
import { useT } from "../../i18n";
import { summarize } from "../../lib/audacGroups";
import { changeText, useGuardRules } from "../../lib/audacWatch";
import type { GuardRule } from "../../lib/audacGroups";

// Changes by someone else that the operator has read ("Clear"); shared by every open panel.
const useCleared = create<{ upTo: number; clear: (id: number) => void }>((set) => ({ upTo: 0, clear: (upTo) => set({ upTo }) }));

export function AudacPanel({ big = false, inRun = false }: { big?: boolean; inRun?: boolean }) {
  const t = useT();
  const st = useAudac();
  const setup = useSettings((s) => s.ui.audac);
  const zones = visible(setup.zones);
  const inputs = visible(setup.inputs);
  // In Run the panel can start locked: you see the levels, but a stray tap changes nothing.
  const [unlocked, setUnlocked] = useState(false);
  const locked = inRun && setup.inRun === "locked" && !unlocked;
  const live = st?.status === "connected" && st.known && !locked;
  // Select mode: tick zones, then one row sets them all.
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  // Making or changing a group right here (not in Run): the ticked zones, a name, Save.
  const [editing, setEditing] = useState<string | null>(null);
  const [groupName, setGroupName] = useState("");
  const groups = (setup.groups ?? []).filter((g) => g.zones.length);
  const stopSelecting = () => { setSelecting(false); setPicked([]); setEditing(null); setGroupName(""); };
  const editGroup = (id: string) => {
    const g = groups.find((x) => x.id === id);
    if (!g) return;
    setSelecting(true);
    setPicked([...g.zones]);
    setEditing(g.id);
    setGroupName(g.name);
  };
  const saveGroup = () => {
    const a = useSettings.getState().ui.audac;
    const list = a.groups ?? [];
    const zonesSorted = [...picked].sort((x, y) => x - y);
    const name = groupName.trim() || t("audac.newGroup");
    const next = editing
      ? list.map((g) => (g.id === editing ? { ...g, name, zones: zonesSorted } : g))
      : [...list, { id: `g${Date.now().toString(36)}`, name, zones: zonesSorted }];
    useSettings.getState().update({ audac: { ...a, groups: next } });
    stopSelecting();
  };
  const deleteGroup = () => {
    const a = useSettings.getState().ui.audac;
    useSettings.getState().update({ audac: { ...a, groups: (a.groups ?? []).filter((g) => g.id !== editing) } });
    stopSelecting();
  };
  const rules = useGuardRules();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: big ? 10 : 6, minHeight: 0 }}>
      <StatusBar st={st} locked={locked} onUnlock={() => setUnlocked(true)} />
      <OthersLine st={st} />
      <Changes st={st} />
      {/* Not set up: no IP and no demo. (The demo needs no address.) */}
      {!setup.host.trim() && !setup.demo ? (
        <span style={{ fontSize: 13, color: "var(--dim)" }}>{t("audac.notSetUp")}</span>
      ) : (
        <div className="scroll" style={{ display: "flex", flexDirection: "column", gap: big ? 8 : 4, opacity: live ? 1 : 0.5, pointerEvents: live ? "auto" : "none", minHeight: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ flex: 1, fontSize: 12, color: "var(--mute)" }}>{selecting ? t("audac.selectHint") : ""}</span>
            <button className="b btn btn-ghost" tabIndex={-1} aria-pressed={selecting} style={{ height: 26, fontSize: 12 }}
              onClick={() => (selecting ? stopSelecting() : setSelecting(true))}>
              {selecting ? t("audac.selectDone") : t("audac.select")}
            </button>
          </div>
          {selecting && picked.length > 0 && (
            <SetRow title={t("s.audac.nSelected", { n: picked.length })} members={picked} st={st} inputs={inputs} big={big} accent />
          )}
          {/* Save the ticked zones as a group (or change the group being edited). Not in Run. */}
          {selecting && !inRun && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <input className="input" tabIndex={-1} aria-label={t("audac.groupName")} placeholder={t("audac.groupName")} value={groupName}
                onChange={(e) => setGroupName(e.target.value)} style={{ flex: 1, minWidth: 120, height: 30 }} />
              <button className="b btn btn-go" tabIndex={-1} disabled={!picked.length} onClick={saveGroup} style={{ height: 30, fontSize: 12.5 }}>
                {editing ? t("audac.saveGroupEdit") : t("audac.saveGroup")}
              </button>
              {editing && (
                <button className="b btn btn-ghost" tabIndex={-1} onClick={deleteGroup} style={{ height: 30, fontSize: 12.5, color: "var(--redtx)" }}>{t("audac.deleteGroup")}</button>
              )}
            </div>
          )}
          {!selecting && groups.map((g) => (
            <SetRow key={g.id} title={g.name || t("audac.newGroup")} members={g.zones} st={st} inputs={inputs} big={big}
              subtitle={g.zones.map((n) => setup.zones[n - 1]?.name || n).join(" · ")}
              onEdit={inRun ? undefined : () => editGroup(g.id)} />
          ))}
          {zones.map((z) => (
            <ZoneRow key={z.n} n={z.n} name={z.name} zone={st?.zones[z.n - 1]} inputs={inputs} big={big} rule={rules.find((r) => r.zone === z.n)}
              pick={selecting ? { on: picked.includes(z.n), toggle: () => setPicked((p) => (p.includes(z.n) ? p.filter((x) => x !== z.n) : [...p, z.n])) } : undefined} />
          ))}
        </div>
      )}
    </div>
  );
}

/** "Also on the MTX: Touch 2" — while another app is connected. */
function OthersLine({ st }: { st: AudacState | null }) {
  const t = useT();
  const names = st?.others ?? [];
  if (!names.length) return null;
  return <span role="status" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ambtx)" }}>! {t("audac.othersNow")} {names.map(otherAppName).join(", ")}</span>;
}

/** "Changed by someone else": the newest few, until the operator clears them. */
function Changes({ st }: { st: AudacState | null }) {
  const t = useT();
  const upTo = useCleared((s) => s.upTo);
  const list = (st?.changes ?? []).filter((c) => c.id > upTo).slice(-3);
  if (!list.length) return null;
  return (
    <div role="status" style={{ display: "flex", flexDirection: "column", gap: 3, padding: "6px 10px", borderRadius: 10, background: "var(--amb)", color: "var(--onamb)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <b style={{ flex: 1, fontSize: 12.5 }}>{t("audac.changes")}</b>
        <button className="b btn btn-ghost" tabIndex={-1} onClick={() => useCleared.getState().clear(list[list.length - 1].id)} style={{ height: 24, fontSize: 12, color: "inherit", border: "1px solid currentColor" }}>{t("audac.clear")}</button>
      </div>
      {list.map((c) => <span key={c.id} style={{ fontSize: 12.5 }}>{changeText(c).replace(`${t("audac.someoneElse")} `, "")}</span>)}
    </div>
  );
}

/**
 * The zone's input as a compact dropdown (instead of a row of buttons). Shows the input even when
 * it's one hidden in Settings, so what the zone plays is never a mystery.
 */
function InputSelect({ label, value, inputs, big, mixed = false, onChange }: {
  label: string;
  value: number;
  inputs: { n: number; name: string }[];
  big: boolean;
  /** A group whose zones are on different inputs. */
  mixed?: boolean;
  onChange: (input: number) => void;
}) {
  const t = useT();
  const allNames = useSettings((s) => s.ui.audac.inputs);
  const known = inputs.some((i) => i.n === value);
  return (
    <select className="select" tabIndex={-1} aria-label={label} value={known ? value : 0}
      onChange={(e) => { const v = Number(e.target.value); if (v) onChange(v); }}
      style={{ width: big ? 190 : 150, height: big ? 32 : 28, fontSize: big ? 13 : 12.5, fontWeight: 600, flex: "none" }}>
      {!known && <option value={0}>{mixed ? "—" : value ? (allNames[value - 1]?.name || t("s.audac.inputN", { n: value })) : "—"}</option>}
      {inputs.map((i) => <option key={i.n} value={i.n}>{i.name}</option>)}
    </select>
  );
}

/** One row that sets several zones at once (a group, or the zones ticked in select mode). */
function SetRow({ title, subtitle, members, st, inputs, big, accent = false, onEdit }: {
  /** A pencil to change or delete the group (outside Run). */
  onEdit?: () => void;
  title: string;
  subtitle?: string;
  members: number[];
  st: AudacState | null;
  inputs: { n: number; name: string }[];
  big: boolean;
  accent?: boolean;
}) {
  const t = useT();
  const sum = summarize(st?.zones ?? [], members);
  const [drag, setDrag] = useState<number | null>(null);
  useEffect(() => setDrag(null), [sum.volume]);
  const shown = drag ?? sum.volume;
  const h = big ? 34 : 28;
  const each = (f: (z: number) => Promise<void>) => members.forEach((z) => void f(z));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: big ? "10px 12px" : "6px 8px", borderRadius: 10, background: "var(--p2)", border: `2px solid ${accent ? "var(--acc)" : "var(--line, transparent)"}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <span className="clamp1" style={{ fontWeight: 800, fontSize: big ? 15 : 13 }}>{title}</span>
          {subtitle && <span className="clamp1" style={{ fontSize: 11.5, color: "var(--mute)" }}>{subtitle}</span>}
        </span>
        {onEdit && (
          <button className="b btn btn-ghost" tabIndex={-1} aria-label={`${t("audac.editGroup")}: ${title}`} title={t("audac.editGroup")} onClick={onEdit}
            style={{ height: h, width: h, justifyContent: "center", padding: 0 }}>✎</button>
        )}
        <span className="mono" style={{ width: 62, textAlign: "right", fontSize: 12.5, color: sum.mute ? "var(--redtx)" : "var(--text)" }}>
          {sum.mute ? t("s.muteTag") : shown >= MIN_VOLUME ? t("audac.wOff") : `−${shown} dB`}
        </span>
        <button className="b btn" tabIndex={-1} aria-label={`${title}: ${t("audac.down")}`} onClick={() => each((z) => audac.step(z, false))} style={{ height: h, width: h, justifyContent: "center", padding: 0 }}>−</button>
        <button className="b btn" tabIndex={-1} aria-label={`${title}: ${t("audac.up")}`} onClick={() => each((z) => audac.step(z, true))} style={{ height: h, width: h, justifyContent: "center", padding: 0 }}>+</button>
        <button className="b chip" tabIndex={-1} aria-pressed={sum.mute} onClick={() => each((z) => audac.setMute(z, !sum.mute))}
          style={{ height: h, background: sum.mute ? "var(--red)" : undefined, color: sum.mute ? "var(--onred)" : undefined }}>
          {t("audac.mute")}
        </button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input type="range" tabIndex={-1} aria-label={t("s.audac.volumeOf", { name: title })} min={0} max={MIN_VOLUME} step={1} value={MIN_VOLUME - shown}
          onChange={(e) => {
            const db = MIN_VOLUME - Number(e.target.value);
            setDrag(db);
            each((z) => audac.setVolume(z, db));
          }} style={{ flex: 1, minWidth: 60 }} />
        <InputSelect label={t("s.audac.inputOf", { name: title })} value={sum.input} inputs={inputs} big={big} mixed={sum.input === 0} onChange={(i) => each((z) => audac.setInput(z, i))} />
      </div>
    </div>
  );
}

function StatusBar({ st, locked, onUnlock }: { st: AudacState | null; locked: boolean; onUnlock: () => void }) {
  const t = useT();
  const status = st?.status ?? "off";
  const color = status === "connected" ? "var(--acc)" : status === "off" ? "var(--mute)" : "var(--amb)";
  const text =
    status === "connected" ? `${t("audac.connected")} ${st!.host}` :
    status === "connecting" ? t("audac.connecting") :
    status === "retrying" ? (st?.message ?? t("audac.retrying")) :
    t("audac.off");
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ width: 9, height: 9, borderRadius: 5, flex: "none", background: color }} />
      <span className="clamp1" title={text} style={{ flex: 1, fontSize: 12.5, color: status === "retrying" ? "var(--ambtx)" : "var(--dim)" }}>{text}</span>
      {locked ? (
        <button className="b btn" tabIndex={-1} onClick={onUnlock} title={t("audac.lockedHint")} style={{ height: 28, fontSize: 12 }}>{t("audac.unlock")}</button>
      ) : status === "off" ? (
        <button className="b btn" tabIndex={-1} onClick={audacConnectSaved} style={{ height: 28, fontSize: 12 }}>{t("audac.connect")}</button>
      ) : (
        // Letting go frees the MTX for the Touch 2 app.
        <button className="b btn btn-ghost" tabIndex={-1} onClick={() => void audac.disconnect()} title={t("audac.releaseHint")} style={{ height: 28, fontSize: 12 }}>{t("audac.release")}</button>
      )}
    </div>
  );
}

function ZoneRow({ n, name, zone, inputs, big, rule, pick }: {
  n: number;
  name: string;
  zone: { volume: number; input: number; mute: boolean } | undefined;
  inputs: { n: number; name: string }[];
  big: boolean;
  /** How this zone is protected right now (Guard, Hold, a running schedule). */
  rule?: GuardRule;
  /** Select mode: a tick box in front of the name. */
  pick?: { on: boolean; toggle: () => void };
}) {
  const t = useT();
  const volume = zone?.volume ?? MIN_VOLUME;
  // While dragging, show the slider's own value; the MTX's answer follows a moment later.
  const [drag, setDrag] = useState<number | null>(null);
  useEffect(() => setDrag(null), [volume]);
  const shown = drag ?? volume;
  const h = big ? 34 : 28;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: big ? "8px 12px" : "5px 8px", borderRadius: 10, background: "var(--p2)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {pick && <input type="checkbox" tabIndex={-1} aria-label={name} checked={pick.on} onChange={pick.toggle} style={{ width: 18, height: 18 }} />}
        <span className="clamp1" style={{ flex: 1, fontWeight: 700, fontSize: big ? 15 : 13 }} onClick={pick?.toggle}>
          {name}
          {rule && (
            <span title={t("audac.guardNote")} style={{ marginLeft: 6, fontSize: 11, color: "var(--acc)" }}>
              ● {rule.full ? (rule.unlimited ? t("audac.hold") : t("audac.guard")) : ""}{rule.ceiling !== null ? `${rule.full ? " · " : ""}≤ −${rule.ceiling} dB` : ""}
            </span>
          )}
        </span>
        <span className="mono" style={{ width: 62, textAlign: "right", fontSize: 12.5, color: zone?.mute ? "var(--redtx)" : "var(--text)" }}>
          {zone?.mute ? t("s.muteTag") : shown >= MIN_VOLUME ? t("audac.wOff") : `−${shown} dB`}
        </span>
        <button className="b btn" tabIndex={-1} aria-label={`${name}: ${t("audac.down")}`} onClick={() => void audac.step(n, false)} style={{ height: h, width: h, justifyContent: "center", padding: 0 }}>−</button>
        <button className="b btn" tabIndex={-1} aria-label={`${name}: ${t("audac.up")}`} onClick={() => void audac.step(n, true)} style={{ height: h, width: h, justifyContent: "center", padding: 0 }}>+</button>
        <button className="b chip" tabIndex={-1} aria-pressed={!!zone?.mute} onClick={() => void audac.setMute(n, !zone?.mute)}
          style={{ height: h, background: zone?.mute ? "var(--red)" : undefined, color: zone?.mute ? "var(--onred)" : undefined }}>
          {t("audac.mute")}
        </button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {/* Right = louder. The MTX counts dB below maximum, so the slider is turned around. */}
        <input type="range" tabIndex={-1} aria-label={t("s.audac.volumeOf", { name })} min={0} max={MIN_VOLUME} step={1} value={MIN_VOLUME - shown}
          onChange={(e) => {
            const db = MIN_VOLUME - Number(e.target.value);
            setDrag(db);
            void audac.setVolume(n, db);
          }} style={{ flex: 1, minWidth: 60 }} />
        <InputSelect label={t("s.audac.inputOf", { name })} value={zone?.input ?? 0} inputs={inputs} big={big} onChange={(i) => void audac.setInput(n, i)} />
      </div>
    </div>
  );
}

/** Top bar button (Build / Preflight); opens the panel in a window. Only shown when an MTX is set up. */
export function AudacButton() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const st = useAudac();
  const on = st?.status === "connected";
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button className="b btn" onClick={() => setOpen(true)} style={{ fontWeight: 700 }}
        title={st?.others?.length ? `${t("audac.othersNow")} ${st.others.map(otherAppName).join(", ")}` : t("audac.title")}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: on ? "var(--acc)" : st?.status === "retrying" ? "var(--amb)" : "var(--mute)" }} />
        AUDAC
        {!!st?.others?.length && (
          <span aria-label={t("audac.othersNow")} style={{ marginLeft: 2, minWidth: 18, height: 18, borderRadius: 9, background: "var(--amb)", color: "var(--onamb)", fontSize: 12, fontWeight: 900, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>!</span>
        )}
      </button>
      {open && (
        <div className="scrim" style={{ position: "fixed", zIndex: 66 }} onClick={() => setOpen(false)}>
          <div className="dialog" role="dialog" aria-label={t("audac.title")} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620, maxHeight: "90%", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 18, fontWeight: 800, flex: 1 }}>{t("audac.title")}</span>
              <button className="b btn btn-ghost" onClick={() => { setOpen(false); useUi.getState().openDialog({ kind: "settings", tab: "audac" }); }}>{t("audac.setup")}</button>
              <button className="b btn btn-ghost" onClick={() => setOpen(false)}>{t("close")} · Esc</button>
            </div>
            <AudacPanel big />
          </div>
        </div>
      )}
    </>
  );
}
