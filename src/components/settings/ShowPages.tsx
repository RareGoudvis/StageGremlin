// Settings › THIS SHOW: saved inside the .sg file, so they travel with the show to another laptop.

import { useT } from "../../i18n";
import { NumField, Row } from "../controls";
import { BackgroundSettings } from "../background/BackgroundPanel";
import { Card, PageTitle, useShowSetting } from "./common";

export function LevelsPage() {
  const t = useT();
  const { settings, set } = useShowSetting();
  return (
    <>
      <PageTitle note={t("set.storedShow")}>{t("set.levels")}</PageTitle>
      <Card title="Loudness">
        <Row label="Target"><NumField label="Loudness target" unit="LUFS" value={settings.targetLufs} min={-30} max={-6} step={0.5} onChange={(v) => set({ targetLufs: v })} /></Row>
        <Help>Every cue is levelled to this.</Help>
        <Row label="Peak ceiling"><NumField label="Peak ceiling" unit="dBTP" value={settings.peakCeilingDb} min={-12} max={0} step={0.5} onChange={(v) => set({ peakCeilingDb: v })} /></Row>
        <Help>Levelling never pushes a cue's loudest peak above this.</Help>
      </Card>
      <Card title="Stopping and riding">
        <Row label="Stop all fade"><NumField label="Stop all fade" unit="s" value={settings.stopAllFade} min={0} max={10} onChange={(v) => set({ stopAllFade: v })} /></Row>
        <Help>Esc fades everything out over this time.</Help>
        <Row label="Under level"><NumField label="Under level" unit="dB" value={settings.underDb} min={-40} max={0} step={1} digits={0} onChange={(v) => set({ underDb: v })} /></Row>
        <Help>How far U drops a song while someone talks (cues can have their own).</Help>
        <Row label="Under fade"><NumField label="Under fade" unit="s" value={settings.underFade} min={0} max={5} onChange={(v) => set({ underFade: v })} /></Row>
      </Card>
      <Card title="Safety">
        <Row label="Double GO">
          <NumField label="Double-GO guard" unit="ms" value={settings.doubleGoMs} min={0} max={2000} step={50} digits={0} onChange={(v) => set({ doubleGoMs: Math.round(v) })} />
        </Row>
        <Help>A second GO within this time is ignored (a nervous double tap).</Help>
      </Card>
    </>
  );
}

export function BackgroundPage() {
  const t = useT();
  return (
    <>
      <PageTitle note={t("set.storedShow")}>{t("set.background")}</PageTitle>
      <BackgroundSettings />
    </>
  );
}

/** The one-line explanation under a setting. */
function Help({ children }: { children: string }) {
  return <span style={{ fontSize: 12.5, color: "var(--mute)", margin: "-6px 0 2px 100px" }}>{children}</span>;
}
