// Preflight: check everything before the audience arrives. Nothing here blocks Run;
// it just makes problems visible while there's still time to fix them.

import { useCallback, useEffect, useState } from "react";
import { useDoc } from "../store";
import { useT } from "../i18n";
import { useEngine } from "../engineStore";
import { usePreflight, type Check } from "../lib/preflight";
import { call, type AudioOutput } from "../lib/tauri";
import type { ToneKind } from "../types";
import { fileSave } from "../lib/fileActions";
import { canEnterRun, checkFiles, locateCue, useMedia } from "../lib/media";
import { openSoundSettings } from "../lib/bgRouting";
import { ask, toast } from "../uiStore";

export function PreflightView() {
  const { checks, passed, allOk } = usePreflight();
  const setManual = useDoc((s) => s.setManualCheck);
  const setMode = useDoc((s) => s.setMode);
  const pct = (passed / checks.length) * 100;
  const t = useT();
  const dumboBlocked = useMedia((s) => s.dumboBlocked);
  const missingCount = useMedia((s) => Object.keys(s.missing).length);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) 400px" }}>
      <section aria-label="Preflight checks" className="scroll" style={{ padding: "26px 40px", display: "flex", flexDirection: "column", gap: 6, borderRight: "1px solid var(--line)" }}>
        <span className="cond" style={{ fontSize: 40, fontWeight: 800, letterSpacing: ".02em" }}>{t("pre.title")}</span>
        <span style={{ fontSize: 15, color: "var(--dim)", marginBottom: 14, maxWidth: 640 }}>
          The app checks what it can by itself; tick the rest yourself. Nothing here blocks you, but it's better to see a problem now than during the show.
        </span>
        {dumboBlocked && missingCount > 0 && (
          <div role="alert" style={{ padding: "10px 14px", borderRadius: 10, background: "var(--ambbg)", border: "1px solid var(--amb)", color: "var(--ambtx)", fontSize: 15, fontWeight: 600 }}>
            {t("dumbo.fixFirst")}
          </div>
        )}
        <span className="k" style={{ marginTop: 4 }}>{t("pre.byApp")}</span>
        {checks.filter((c) => c.kind === "auto").map((c) => <CheckRow key={c.key} check={c} />)}
        <span className="k" style={{ marginTop: 14 }}>{t("pre.yours")}</span>
        {checks.filter((c) => c.kind === "manual").map((c) => (
          <CheckRow key={c.key} check={c} onToggle={() => setManual(c.key, !c.ok)} />
        ))}
      </section>

      <aside className="scroll" style={{ padding: "26px 30px", display: "flex", flexDirection: "column", gap: 14 }}>
        <span className="k">Status</span>
        <span className="cond" style={{ fontSize: 30, fontWeight: 800, color: allOk ? "var(--acc)" : "var(--amb)" }}>
          {allOk ? t("pre.ready") : `${checks.length - passed} ${t("pre.open")}`}
        </span>
        <div style={{ height: 10, background: "var(--p3)", borderRadius: 5, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: allOk ? "var(--acc)" : "var(--amb)", transition: "width .2s" }} />
        </div>
        <button
          className="b cond"
          onClick={() => canEnterRun() && setMode("run")}
          style={{ height: 76, borderRadius: 14, fontSize: 26, fontWeight: 800, letterSpacing: ".08em", background: "var(--gobg)", color: "var(--ongo)" }}
        >
          {t("pre.goRun")}
        </button>
        <span style={{ fontSize: 13, color: "var(--mute)" }}>
          Run switches to black, locks editing and turns Space into GO. Leave it with Ctrl+1 pressed twice, or hold Build for a second.
        </span>
        <CalibrationCard />
        <OutputPicker />
        <OutputPicker preview />
      </aside>
    </div>
  );
}

function CheckRow({ check, onToggle }: { check: Check; onToggle?: () => void }) {
  const content = (
    <>
      <span
        aria-hidden="true"
        style={{
          width: 30, height: 30, borderRadius: 15, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 15, flex: "none",
          background: check.ok ? "var(--gobg)" : check.kind === "manual" ? "var(--p3)" : "var(--amb)",
          color: check.ok ? "var(--ongo)" : check.kind === "manual" ? "var(--dim)" : "var(--onamb)",
        }}
      >
        {check.ok ? "✓" : check.kind === "manual" ? "" : "!"}
      </span>
      <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, textAlign: "left" }}>
        <span style={{ fontSize: 16, fontWeight: 600 }}>{check.title}</span>
        <span style={{ fontSize: 13, color: "var(--dim)" }}>{check.detail}</span>
      </span>
      {check.key === "missing" && check.fixId && (
        <span role="button" tabIndex={0} className="b btn" onClick={() => void locateCue(check.fixId!)} onKeyDown={(e) => e.key === "Enter" && void locateCue(check.fixId!)}
          style={{ background: "var(--red)", color: "var(--onred)", fontWeight: 700 }}>Locate…</span>
      )}
      {check.key === "bgRoute" && !check.ok && (
        <span role="button" tabIndex={0} className="b btn" onClick={openSoundSettings} onKeyDown={(e) => e.key === "Enter" && openSoundSettings()}>
          Open Windows sound settings
        </span>
      )}
      {check.key === "verify" && !check.ok && (
        <span role="button" tabIndex={0} className="b btn" onClick={() => void checkFiles()} onKeyDown={(e) => e.key === "Enter" && void checkFiles()}>
          Check again
        </span>
      )}
      {check.key === "saved" && !check.ok && (
        <span role="button" tabIndex={0} className="b btn" onClick={() => void fileSave()} onKeyDown={(e) => e.key === "Enter" && void fileSave()}>Save now</span>
      )}
    </>
  );
  const style = {
    display: "flex", alignItems: "center", gap: 16, padding: "12px 16px", borderRadius: 12, width: "100%",
    background: check.ok || check.kind === "manual" ? "var(--p1)" : "var(--ambbg)",
    border: `1px solid ${check.ok || check.kind === "manual" ? "var(--line)" : "var(--amb)"}`,
    color: "var(--text)",
  } as const;
  if (!onToggle) return <div style={style}>{content}</div>;
  return (
    <button className="b" role="checkbox" aria-checked={check.ok} onClick={onToggle} style={{ ...style, fontFamily: "inherit" }}>
      {content}
    </button>
  );
}

/** Calibration tones through the show output: pink noise at the target loudness, or a 1 kHz line-up tone. */
/** Sine presets: the octave bands a desk or room EQ is usually set by. */
const SINE_PRESETS = [63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export function CalibrationCard() {
  const [tone, setTone] = useState<ToneKind | null>(null);
  const [hz, setHz] = useState(1000);
  const target = useDoc((s) => s.show.settings.targetLufs);
  const play = async (kind: ToneKind | null, freq = hz) => {
    try {
      await call("engine_tone", { kind, hz: freq });
      setTone(kind);
    } catch (e) {
      toast(`Tone failed: ${e}`);
    }
  };
  // Leaving Preflight stops the tone.
  useEffect(() => () => void call("engine_tone", { kind: null }).catch(() => {}), []);
  return (
    <div style={{ padding: 14, borderRadius: 12, border: "1px solid var(--line)", background: "var(--p1)", display: "flex", flexDirection: "column", gap: 8 }}>
      <span className="k">Calibrate the desk</span>
      <span style={{ fontSize: 12.5, color: "var(--dim)" }}>
        Pink noise plays at {target} LUFS, the level every cue is matched to. Set the desk's USB channel gain so its meter reads 0 at unity fader.
      </span>
      <div style={{ display: "flex", gap: 6 }}>
        <button className="b chip" aria-pressed={tone === "pink"} onClick={() => void play("pink")} style={{ height: 36, flex: 1 }}>Pink noise</button>
        <button className="b chip" aria-pressed={tone === "line"} onClick={() => void play("line")} style={{ height: 36, flex: 1 }}>Sine {fmtHz(hz)} −20 dBFS</button>
        <button className="b btn" disabled={!tone} onClick={() => void play(null)} style={{ height: 36 }}>Stop</button>
      </div>
      {/* Sine frequency: a preset, or type one. A playing sine follows straight away. */}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
        {SINE_PRESETS.map((f) => (
          <button key={f} className="b chip" aria-pressed={hz === f} onClick={() => { setHz(f); if (tone === "line") void play("line", f); }}
            style={{ height: 28, fontSize: 12, padding: "0 8px" }}>{fmtHz(f)}</button>
        ))}
        <input className="input mono" aria-label="Sine frequency in Hz" type="number" min={20} max={20000} step={1} value={hz}
          onChange={(e) => setHz(Math.max(20, Math.min(20000, Number(e.target.value) || 1000)))}
          onBlur={() => tone === "line" && void play("line")} onKeyDown={(e) => e.key === "Enter" && void play("line")}
          style={{ width: 90, height: 28 }} />
        <span style={{ fontSize: 12, color: "var(--dim)" }}>Hz</span>
      </div>
    </div>
  );
}

function fmtHz(f: number): string {
  return f >= 1000 ? `${+(f / 1000).toFixed(2)} kHz` : `${f} Hz`;
}

/**
 * Choose the show output (the Qu-24 USB), or with `preview`, the headphone output.
 * Empty = follow the Windows default.
 */
export function OutputPicker({ preview = false }: { preview?: boolean }) {
  const [previewChoice, setPreviewChoice] = useState<string>("");
  const output = useEngine((s) => s.output);
  const [list, setList] = useState<AudioOutput[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      setList(await call("audio_list_outputs"));
    } catch (e) {
      toast(`Could not list outputs: ${e}`);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => void refresh(), [refresh]);

  const choose = async (name: string) => {
    try {
      if (preview) {
        await call("audio_set_preview_output", { name: name || null });
        setPreviewChoice(name);
        return;
      }
      // Mid-show the operator should know what they're about to do.
      if (useDoc.getState().mode === "run") {
        const ok = await ask({
          title: "Switch the show output now?",
          body: "Switching restarts the audio engine: there is a short silence on the output. Only do this if the sound is already gone.",
          confirmLabel: "Switch output",
          danger: true,
        });
        if (!ok) return;
      }
      await call("audio_set_output", { name: name || null });
    } catch (e) {
      toast(`Could not switch output: ${e}`);
    }
  };

  const preferred = preview ? previewChoice : output?.preferred ?? "";
  // Keep the chosen device in the list even when it's unplugged, so it's clear what's missing.
  const names = list.map((o) => o.name);
  if (preferred && !names.includes(preferred)) names.push(preferred);

  return (
    <div style={{ marginTop: 10, padding: 14, borderRadius: 12, border: "1px solid var(--line)", background: "var(--p1)", display: "flex", flexDirection: "column", gap: 8 }}>
      <span className="k">{preview ? "Headphone preview output" : "Show output"}</span>
      <span style={{ fontSize: 12.5, color: "var(--mute)" }}>
        {preview
          ? "Where Preview (H) plays. Pick the laptop's headphone jack, never the desk."
          : "Switching restarts the audio engine (a short silence). In Run it asks first."}
      </span>
      <div style={{ display: "flex", gap: 6 }}>
        <select className="select" aria-label="Audio output" value={preferred} onChange={(e) => void choose(e.target.value)} style={{ flex: 1, height: 36 }}>
          <option value="">Windows default{list.find((o) => o.isDefault) ? ` (${list.find((o) => o.isDefault)!.name})` : ""}</option>
          {names.map((n) => (
            <option key={n} value={n}>{n}{list.some((o) => o.name === n) ? "" : " — not connected"}</option>
          ))}
        </select>
        <button className="b btn" disabled={busy} onClick={() => void refresh()} style={{ height: 36 }}>Refresh</button>
      </div>
      {preview && previewChoice && previewChoice === output?.outputName && (
        <span className="tag tag-red" style={{ alignSelf: "flex-start" }}>SAME AS THE SHOW OUTPUT: PREVIEW WOULD PLAY IN THE HALL</span>
      )}
      {!preview && <span style={{ fontSize: 12.5, color: output?.outputFound === false ? "var(--redtx)" : "var(--dim)" }}>
        {output ? (output.outputFound ? `Playing on ${output.outputName}.` : `${output.preferred} isn't connected — playing on ${output.outputName} until it is.`) : "Waiting for the engine…"}
      </span>}
    </div>
  );
}
