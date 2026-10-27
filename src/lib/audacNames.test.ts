import { describe, expect, it } from "vitest";
import { applyMtxNames, DEFAULT_INPUT_NAMES, DEFAULT_ZONE_NAMES, mtxNames } from "./audacNames";

const thirty = (f: (i: number) => string) => Array.from({ length: 30 }, (_, i) => f(i));

describe("names from the MTX", () => {
  it("maps 1–8 to zones, 9–14 to inputs 1–6 and zone 1's wall-panel pair to inputs 7–8", () => {
    const n = mtxNames(thirty((i) => `n${i + 1}`))!;
    expect(n.zones).toEqual(["n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8"]);
    expect(n.inputs).toEqual(["n9", "n10", "n11", "n12", "n13", "n14", "n15", "n16"]);
  });

  it("is null until the MTX has sent a name", () => {
    expect(mtxNames(undefined)).toBeNull();
    expect(mtxNames(thirty(() => ""))).toBeNull();
  });

  it("only fills untouched names automatically, and never empties one", () => {
    const zones = DEFAULT_ZONE_NAMES.map((name, i) => ({ name: i === 1 ? "Podium (ours)" : name, show: i !== 7 }));
    const fromMtx = ["Gym", "Podium", "", "Infants", "", "", "", "Afdak"];
    const out = applyMtxNames(zones, fromMtx, DEFAULT_ZONE_NAMES, true);
    expect(out.map((z) => z.name)).toEqual(["Gym", "Podium (ours)", "Zone 3", "Infants", "Zone 5", "Zone 6", "Zone 7", "Afdak"]);
    expect(out[7].show).toBe(false);
  });

  it("the button replaces every name the MTX has", () => {
    const inputs = DEFAULT_INPUT_NAMES.map((name) => ({ name: name + "!", show: true }));
    const out = applyMtxNames(inputs, ["Micro", "Streambox", "", "", "", "", "", ""], DEFAULT_INPUT_NAMES, false);
    expect(out.slice(0, 3).map((x) => x.name)).toEqual(["Micro", "Streambox", "Line 3!"]);
  });
});
