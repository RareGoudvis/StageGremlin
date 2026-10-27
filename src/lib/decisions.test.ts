import { describe, expect, it } from "vitest";
import { decideStopKey, sameDevice } from "./decisions";

describe("emergency keys (review #5)", () => {
  it("Esc with nothing open = Stop all; again within 500 ms = Panic", () => {
    const a = decideStopKey({ now: 1000, lastPress: 0, overlayOpen: false, isEscape: true });
    expect(a.action).toBe("stopAll");
    const b = decideStopKey({ now: 1300, lastPress: a.lastPress, overlayOpen: false, isEscape: true });
    expect(b.action).toBe("panic");
  });

  it("Esc with a dialog open only closes it, but Esc Esc is still Panic", () => {
    const a = decideStopKey({ now: 1000, lastPress: 0, overlayOpen: true, isEscape: true });
    expect(a.action).toBe("closeOverlay");
    // The dialog closed on the first press; the second press still counts.
    const b = decideStopKey({ now: 1200, lastPress: a.lastPress, overlayOpen: false, isEscape: true });
    expect(b.action).toBe("panic");
    // Even while another dialog is still open.
    const c = decideStopKey({ now: 1200, lastPress: a.lastPress, overlayOpen: true, isEscape: true });
    expect(c.action).toBe("panic");
  });

  it("a slow second press is a fresh press, not Panic", () => {
    const a = decideStopKey({ now: 1000, lastPress: 0, overlayOpen: false, isEscape: true });
    const b = decideStopKey({ now: 1600, lastPress: a.lastPress, overlayOpen: false, isEscape: true });
    expect(b.action).toBe("stopAll");
  });

  it("a Stop-all key that is not Esc stops at once, even with a dialog open", () => {
    const a = decideStopKey({ now: 1000, lastPress: 0, overlayOpen: true, isEscape: false });
    expect(a.action).toBe("stopAll");
  });

  it("after Panic the count starts over", () => {
    const p = decideStopKey({ now: 1300, lastPress: 1000, overlayOpen: false, isEscape: true });
    expect(p.action).toBe("panic");
    const next = decideStopKey({ now: 1500, lastPress: p.lastPress, overlayOpen: false, isEscape: true });
    expect(next.action).toBe("stopAll");
  });
});

describe("background routing (review #7)", () => {
  it("matches the same device under slightly different names", () => {
    expect(sameDevice("Qu-24 USB", "Qu-24 USB")).toBe(true);
    expect(sameDevice("Speakers (Qu-24 USB)", "qu-24 usb")).toBe(true);
    expect(sameDevice("Speakers (Realtek(R) Audio)", "Qu-24 USB")).toBe(false);
    expect(sameDevice(null, "Qu-24 USB")).toBe(false);
  });
});
