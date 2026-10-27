import { describe, expect, it } from "vitest";
import { activeGuard, describeChange, guardRules, summarize, volumeFor } from "./audacGroups";

const z = (volume: number, input: number, mute = false) => ({ volume, input, mute });

describe("AUDAC groups", () => {
  it("shows a group as its loudest zone, a shared input, muted only when all are", () => {
    const zones = [z(30, 2), z(20, 2, true), z(40, 3, true)];
    expect(summarize(zones, [1, 2])).toEqual({ volume: 20, mute: false, input: 2 });
    expect(summarize(zones, [2, 3])).toEqual({ volume: 20, mute: true, input: 0 });
    expect(summarize(zones, [])).toEqual({ volume: 70, mute: false, input: 0 });
  });

  it("guards only when asked: always, or only in Run", () => {
    expect(activeGuard({ zones: [5, 1], when: "always" }, false)).toEqual([1, 5]);
    expect(activeGuard({ zones: [5], when: "run" }, false)).toEqual([]);
    expect(activeGuard({ zones: [5], when: "run" }, true)).toEqual([5]);
    expect(activeGuard({ zones: [5], when: "off" }, true)).toEqual([]);
  });

  it("describes a change by someone else with the names used here", () => {
    const words = { volume: "volume", input: "input", mute: "mute", on: "on", off: "off", putBack: "put back" };
    const text = describeChange({ id: 1, at: new Date(2026, 9, 27, 9, 31).getTime(), zone: 5, what: "input", from: 3, to: 4, restored: true },
      (n) => ["", "", "", "", "", "Podium"][n], (n) => ["", "", "", "CD - USB", "Aux"][n], words);
    expect(text).toMatch(/09.31 · Podium: input CD - USB → Aux \(put back\)/);
  });

  it("Hold has no limit; a polite guard does", () => {
    expect(guardRules({ zones: [2], when: "always", strength: "hold" }, false, [])).toEqual([{ zone: 2, full: true, ceiling: null, unlimited: true }]);
    expect(guardRules({ zones: [2], when: "always" }, false, [])[0].unlimited).toBe(false);
  });

  it("a running scheduled time keeps its zones from being turned up past their level", () => {
    const lunch = { zones: [3, 4], volume: 30, zoneVolumes: { "4": 24 }, protect: undefined };
    expect(volumeFor(lunch, 3)).toBe(30);
    expect(guardRules({ zones: [], when: "off" }, false, [lunch])).toEqual([
      { zone: 3, full: false, ceiling: 30, unlimited: true },
      { zone: 4, full: false, ceiling: 24, unlimited: true },
    ]);
    expect(guardRules({ zones: [], when: "off" }, false, [{ ...lunch, protect: "off" }])).toEqual([]);
  });

  it("the strictest rule wins when Guard and a schedule meet on one zone", () => {
    const a = { zones: [3], volume: 30, protect: "noLouder" as const };
    const b = { zones: [3], volume: 40, protect: "full" as const };
    expect(guardRules({ zones: [3], when: "always" }, false, [a, b])).toEqual([{ zone: 3, full: true, ceiling: 40, unlimited: true }]);
  });
});
