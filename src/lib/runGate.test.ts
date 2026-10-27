import { describe, expect, it } from "vitest";
import { filesSignature, runGate, type GateInput } from "./runGate";

const ok: GateInput = { checkState: "ok", checkedCurrent: true, missing: [], unreadable: [], analysing: [] };

describe("Run gate (review #4)", () => {
  it("lets you in only when the check finished OK for the current show", () => {
    expect(runGate(ok).ok).toBe(true);
  });
  it("blocks while the check has not run yet", () => {
    expect(runGate({ ...ok, checkState: "idle" }).ok).toBe(false);
  });
  it("blocks while the check is still running", () => {
    expect(runGate({ ...ok, checkState: "checking" }).ok).toBe(false);
  });
  it("blocks when the check itself failed, and says why", () => {
    const g = runGate({ ...ok, checkState: "failed", checkError: "disk gone" });
    expect(g.ok).toBe(false);
    expect(g.reason).toContain("disk gone");
  });
  it("blocks when the result belongs to an older version of the show", () => {
    expect(runGate({ ...ok, checkedCurrent: false }).ok).toBe(false);
  });
  it("blocks on a missing file (cue or pad)", () => {
    expect(runGate({ ...ok, missing: ["pad-1"] }).ok).toBe(false);
  });
  it("blocks on a file that is there but can't be decoded", () => {
    expect(runGate({ ...ok, unreadable: ["cue-3"] }).ok).toBe(false);
  });
  it("blocks while files are still being analysed", () => {
    expect(runGate({ ...ok, analysing: ["cue-1"] }).ok).toBe(false);
  });
  it("a changed file list gives a different signature", () => {
    const a = filesSignature([{ id: "1", file: "media/a.m4a" }, { id: "2", file: "media/b.m4a" }]);
    const b = filesSignature([{ id: "2", file: "media/b.m4a" }, { id: "1", file: "media/a.m4a" }]);
    const c = filesSignature([{ id: "1", file: "media/a.m4a" }, { id: "2", file: "media/c.m4a" }]);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
