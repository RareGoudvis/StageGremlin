import { describe, expect, it } from "vitest";
import { activeGuard, describeChange, summarize } from "./audacGroups";

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
});
