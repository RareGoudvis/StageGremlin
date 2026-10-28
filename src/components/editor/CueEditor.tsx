// The big cue editor (double-click a cue, or Enter in Build). Also opens for pads.
// Top: waveform with every handle. Middle: vamp loop, markers, attached cues.
// Bottom: EQ, compressor, output. H previews in the headphones from the clicked spot; Esc stops / closes.

import { useEffect, useState, type ReactNode } from "react";
import { useDoc } from "../../store";
import { useUi } from "../../uiStore";
import type { Cue } from "../../types";
import { allCues, goQueue, normGain } from "../../types";
import { findAnyCue, padOfCue, updateAnyCue } from "../../lib/showOps";
import { ensureWaveform } from "../../lib/fileActions";
import { previewPlay, previewStop, usePreview, usePreviewInHall } from "../../lib/preview";
import { fmtDb, fmtTime } from "../../lib/format";
import { useWaveform } from "../../hooks/useWaveform";
import { Chips, NumField, Row, Slider } from "../controls";
import { FileStatus } from "../build/FileStatus";
import { WaveEditor, type AttachedChild } from "./WaveEditor";
import { EqPanel } from "./EqPanel";
import { CompPanel } from "./CompPanel";
import { openMenu } from "../ContextMenu";
import { waveMenu } from "../../lib/menus";
import { useT } from "../../i18n";

export function CueEditor() {
  const id = useUi((s) => s.editorCueId);
  const cue = useDoc((s) => findAnyCue(s.show, id));
  if (!id || !cue) return null;
  return <Editor key={id} cue={cue} />;
}

function Editor({ cue }: { cue: Cue }) {
  const t = useT();
  const show = useDoc((s) => s.show);
  const edit = useDoc((s) => s.edit);
  const close = useUi((s) => s.closeEditor);
  const waveform = useWaveform(cue.file);
  const isPad = !!padOfCue(show, cue.id);
  const [cursor, setCursor] = useState(cue.trimIn);
  const preview = usePreview((s) => (s.cueId === cue.id && s.state?.playing ? s.state : null));
  const inHall = usePreviewInHall();

  useEffect(() => ensureWaveform(cue.id), [cue.id, cue.file]);

  const set = (patch: Partial<Cue>, key?: string) =>
    edit((s) => updateAnyCue(s, cue.id, patch), key ? { coalesce: `${cue.id}:${key}` } : undefined);

  // Cues hung on this one (they start by themselves at `attach.at`).
  const children: AttachedChild[] = allCues(show)
    .filter((c) => c.attach?.to === cue.id)
    .map((c) => ({ id: c.id, number: c.number, name: c.name, at: c.attach!.at }));
  const candidates = isPad || cue.attach ? [] : goQueue(show).filter((c) => c.id !== cue.id && !allCues(show).some((x) => x.attach?.to === c.id));
  const setChildAt = (childId: string, at: number, key?: string) =>
    edit((s) => updateAnyCue(s, childId, (c) => ({ attach: c.attach ? { ...c.attach, at } : null })), key ? { coalesce: key } : undefined);

  const togglePreview = () => (preview ? void previewStop() : void previewPlay(cue, cursor));

  // H = preview from the cursor; Esc = stop the preview, or close the editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useUi.getState().confirm) return;
      const typing = (e.target as HTMLElement).closest("input, textarea, select");
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (typing) (e.target as HTMLElement).blur();
        else if (usePreview.getState().state?.playing) void previewStop();
        else close();
        return;
      }
      if (!typing && e.key.toLowerCase() === "h" && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        togglePreview();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  // Stop the preview when the editor closes.
  useEffect(() => () => void (usePreview.getState().state?.playing && previewStop()), []);

  const renameMarker = (i: number) => document.getElementById(`marker-label-${i}`)?.focus();
  const norm = normGain(cue.loudness, show.settings);
  const dur = cue.loudness?.duration ?? 0;

  return (
    <div className="scrim" style={{ padding: 20, alignItems: "stretch", zIndex: 65 }}>
      <div role="dialog" aria-label={t("b.ed.cueEditor")} className="scroll" style={{ width: "100%", maxWidth: 1320, margin: "0 auto", background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 18, display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", borderBottom: "1px solid var(--line)", position: "sticky", top: 0, background: "var(--bg)", zIndex: 6 }}>
          <span className="k">{isPad ? t("b.ed.padEditor") : t("b.ed.cueEditor")}</span>
          {!isPad && <span className="mono" style={{ fontSize: 20, fontWeight: 600, color: "var(--acc)" }}>{cue.number}</span>}
          <input className="input" aria-label={t("sched.name")} value={cue.name} onChange={(e) => set({ name: e.target.value }, "name")} style={{ fontSize: 18, fontWeight: 700, height: 38, flex: 1, maxWidth: 480 }} />
          <span style={{ flex: 1 }} />
          {inHall && <span className="tag tag-red" title={t("b.ed.inHallTip")}>{t("b.ed.inHall")}</span>}
          <button className="b btn" onClick={togglePreview} aria-pressed={!!preview}
            style={{ height: 38, background: preview ? "var(--st)" : "var(--stbg)", color: preview ? "var(--bg)" : "var(--st)", border: "1px solid var(--st)", fontWeight: 800 }}>
            {preview ? t("b.ed.stopPreview", { t: fmtTime(preview.position) }) : t("b.ed.previewFrom", { t: fmtTime(cursor) })}
          </button>
          <button className="b btn" onClick={close} style={{ height: 38, padding: "0 18px", background: "var(--hl)", color: "var(--bg)", fontWeight: 800 }}>{t("b.ed.done")}</button>
        </div>

        {/* Waveform */}
        <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10, borderBottom: "1px solid var(--line)" }}>
          <FileStatus cue={cue} />
          <WaveEditor
            cue={cue} waveform={waveform} set={set}
            attached={children} setAttachedAt={(cid, at, key) => setChildAt(cid, at, key)}
            cursor={cursor} setCursor={setCursor}
            previewPos={preview ? preview.position : null}
            onRenameMarker={renameMarker}
            onMenu={(e, at) => openMenu(e, waveMenu(cue, at, { setCursor, preview: (at) => void previewPlay(cue, at) }))}
          />
          <div className="mono" style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--mute)" }}>
            <span>0:00</span>
            <span>{t("b.ed.help")}</span>
            <span>{fmtTime(dur)}</span>
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            <Step label={t("b.ed.in")}><NumField label={t("b.wave.trimIn")} unit="s" value={cue.trimIn} min={0} max={dur} onChange={(v) => set({ trimIn: v })} /></Step>
            <Step label={t("b.ed.out")}><NumField label={t("b.wave.trimOut")} unit="s" value={cue.trimOut ?? dur} min={0} max={dur} onChange={(v) => set({ trimOut: v >= dur ? null : v })} /></Step>
            <Step label={t("b.fadeIn")}><NumField label={t("b.fadeIn")} unit="s" value={cue.fadeIn} min={0} onChange={(v) => set({ fadeIn: v })} /></Step>
            <Step label={t("b.fadeOut")}><NumField label={t("b.fadeOut")} unit="s" value={cue.fadeOut} min={0} onChange={(v) => set({ fadeOut: v })} /></Step>
            <Step label={t("b.ed.stopFade")}><NumField label={t("b.ed.stopFade")} unit="s" value={cue.stopFade} min={0} onChange={(v) => set({ stopFade: v })} /></Step>
            <Chips<Cue["curve"]> label={t("b.ed.curve")} value={cue.curve} onChange={(curve) => set({ curve })}
              options={[{ value: "linear", label: t("b.ed.linear") }, { value: "sCurve", label: t("b.ed.sCurve") }, { value: "exponential", label: t("b.ed.exponential") }]} />
          </div>

          {!isPad && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
              {/* Vamp loop */}
              <Card title={t("b.ed.vamp")} color="var(--cy)"
                right={<button className="b chip" aria-pressed={!!cue.vamp?.on} onClick={() => set({ vamp: cue.vamp ? { ...cue.vamp, on: !cue.vamp.on } : { a: Math.max(cue.trimIn, cursor), b: Math.min(dur, Math.max(cue.trimIn, cursor) + 8), on: true } })}>
                  {cue.vamp?.on ? t("sched.on") : t("sched.off")}
                </button>}>
                <span style={{ fontSize: 12.5, color: "var(--dim)" }}>{t("b.ed.vampHelp")}</span>
                {cue.vamp && (
                  <>
                    <Row label={t("b.ed.loopA")}><NumField label={t("b.ed.loopStart")} unit="s" value={cue.vamp.a} min={0} max={cue.vamp.b} onChange={(a) => set({ vamp: { ...cue.vamp!, a } })} /></Row>
                    <Row label={t("b.ed.loopB")}><NumField label={t("b.ed.loopEnd")} unit="s" value={cue.vamp.b} min={cue.vamp.a} max={dur} onChange={(b) => set({ vamp: { ...cue.vamp!, b } })} /></Row>
                  </>
                )}
              </Card>

              {/* Markers */}
              <Card title={t("b.ed.markers")} color="var(--lx)"
                right={<button className="b btn" style={{ height: 28, background: "var(--lxbg)", color: "var(--lx)", fontWeight: 700 }}
                  onClick={() => set({ markers: [...cue.markers, { t: cursor, label: t("b.markerN", { n: cue.markers.length + 1 }) }].sort((a, b) => a.t - b.t) })}>{t("b.ed.atCursor")}</button>}>
                <span style={{ fontSize: 12.5, color: "var(--dim)" }}>{t("b.ed.markersHelp")}</span>
                {cue.markers.map((m, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <NumField label={t("b.ed.markerTime")} value={m.t} min={0} max={dur} width={62} onChange={(mt) => set({ markers: cue.markers.map((x, j) => (j === i ? { ...x, t: mt } : x)).sort((a, b) => a.t - b.t) })} />
                    <input id={`marker-label-${i}`} className="input" aria-label={t("b.ed.markerLabel")} value={m.label} style={{ flex: 1, height: 30, color: "var(--lx)" }}
                      onChange={(e) => set({ markers: cue.markers.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) }, `marker-label-${i}`)} />
                    <button className="b btn btn-icon" aria-label={t("b.ed.deleteMarker")} style={{ height: 30, width: 30 }} onClick={() => set({ markers: cue.markers.filter((_, j) => j !== i) })}>×</button>
                  </div>
                ))}
                {!cue.markers.length && <span style={{ fontSize: 12.5, color: "var(--mute)" }}>{t("b.ed.noMarkers")}</span>}
              </Card>

              {/* Attached cues */}
              <Card title={t("b.ed.attached")} color="var(--amb)">
                <span style={{ fontSize: 12.5, color: "var(--dim)" }}>{t("b.ed.attachedHelp")}</span>
                {children.map((c) => (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="mono" style={{ fontWeight: 600, width: 34, color: "var(--amb)" }}>{c.number}</span>
                    <span className="clamp1" style={{ flex: 1, fontSize: 13.5 }}>{c.name}</span>
                    <NumField label={t("b.ed.startsAt")} unit="s" value={c.at} min={0} max={dur} width={62} onChange={(at) => setChildAt(c.id, at)} />
                    <button className="b btn btn-icon" aria-label={t("b.ed.detach")} title={t("b.ed.detachTip")} style={{ height: 30, width: 30 }}
                      onClick={() => edit((s) => updateAnyCue(s, c.id, { attach: null }))}>×</button>
                  </div>
                ))}
                {cue.attach && <span style={{ fontSize: 12.5, color: "var(--mute)" }}>{t("b.ed.isAttached")}</span>}
                {candidates.length > 0 && (
                  <select className="select" aria-label={t("b.ed.attachCue")} value="" onChange={(e) => e.target.value && edit((s) => updateAnyCue(s, e.target.value, { attach: { to: cue.id, at: cursor } }))}>
                    <option value="">{t("b.ed.attachAt", { t: fmtTime(cursor) })}</option>
                    {candidates.map((c) => <option key={c.id} value={c.id}>{c.number} {c.name}</option>)}
                  </select>
                )}
              </Card>
            </div>
          )}
        </div>

        {/* Sound: EQ, compressor, output */}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.35fr) minmax(0, 1fr) minmax(0, .8fr)" }}>
          <div style={{ padding: "16px 18px", borderRight: "1px solid var(--line)" }}><EqPanel cue={cue} set={set} /></div>
          <div style={{ padding: "16px 18px", borderRight: "1px solid var(--line)" }}><CompPanel cue={cue} set={set} /></div>
          <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
            <span className="k">{t("b.ed.output")}</span>
            <div style={{ padding: 12, borderRadius: 10, background: "var(--p1)", border: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="mono" style={{ fontSize: 22, fontWeight: 600 }}>{fmtDb(norm.gainDb + cue.gainDb)}</span>
              <span style={{ fontSize: 12.5, color: "var(--dim)" }}>
                {cue.loudness ? t("b.ed.match", { db: fmtDb(norm.gainDb), lufs: show.settings.targetLufs }) : t("b.ed.notAnalysed")}
                {cue.gainDb !== 0 ? t("b.ed.plusYours", { db: fmtDb(cue.gainDb) }) : ""}
              </span>
            </div>
            {norm.peakLimited && (
              <span style={{ fontSize: 12.5, padding: "8px 10px", borderRadius: 8, background: "var(--ambbg)", color: "var(--ambtx)" }}>
                {t("b.ed.peakLimited", { db: show.settings.peakCeilingDb })}
              </span>
            )}
            <Row label={t("b.gain")}><Slider label={t("b.gain")} min={-24} max={12} step={0.5} value={cue.gainDb} format={(v) => fmtDb(v)} onChange={(v) => set({ gainDb: v }, "gain")} /></Row>
            <Row label={t("b.pan")}><Slider label={t("b.pan")} min={-1} max={1} step={0.05} value={cue.pan} format={(v) => (Math.abs(v) < 0.01 ? "C" : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)} onChange={(v) => set({ pan: v }, "pan")} /></Row>
            <button className="b chip" aria-pressed={cue.duckBg} onClick={() => set({ duckBg: !cue.duckBg })} style={{ height: 36 }}>
              {cue.duckBg ? t("b.ed.duckOn") : t("b.ed.duckOff")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Step({ label, children }: { label: string; children: ReactNode }) {
  return <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span className="k">{label}</span>{children}</span>;
}

function Card({ title, color, right, children }: { title: string; color: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ padding: 12, borderRadius: 10, background: "var(--p1)", border: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="k" style={{ color, marginRight: "auto" }}>{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}
