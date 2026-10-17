import { describe, expect, it } from "vitest";
import { canTransition } from "../../src/server/workflow/states";
import { scanText } from "../../src/server/workflow/safety";
import { weekDates, zonedToUtc } from "../../src/server/time";
import { summarize } from "../../src/server/services/analytics";
import { decryptSecret, encryptSecret, secretHint } from "../../src/server/crypto";

describe("content state machine", () => {
  it("follows the documented happy path", () => {
    const path = ["IDEA", "PROMPT_READY", "GENERATING", "PROCESSING", "AWAITING_APPROVAL", "APPROVED", "SCHEDULED", "PUBLISHED"] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i], path[i + 1])).toBe(true);
  });
  it("cannot skip approval", () => {
    expect(canTransition("IDEA", "APPROVED")).toBe(false);
    expect(canTransition("PROMPT_READY", "SCHEDULED")).toBe(false);
    expect(canTransition("REJECTED", "SCHEDULED")).toBe(false);
    expect(canTransition("AWAITING_APPROVAL", "PUBLISHED")).toBe(false);
    expect(canTransition("GENERATING", "APPROVED")).toBe(false);
  });
});

describe("content safety", () => {
  it("blocks references to minors and youthful appearance", () => {
    for (const t of ["a teen at the beach", "17 year old model", "school uniform look", "barely legal", "young-looking guy"]) {
      expect(scanText("prompt", t).length, t).toBeGreaterThan(0);
    }
  });
  it("blocks requests for another person's likeness", () => {
    expect(scanText("prompt", "make a deepfake of a famous actor").length).toBeGreaterThan(0);
  });
  it("allows ordinary adult creative direction", () => {
    for (const t of ["30-year-old man, golden hour rooftop workout", "boyfriend-style casual shirt", "kidney-shaped pool in Miami"]) {
      expect(scanText("prompt", t), t).toEqual([]);
    }
  });
});

describe("time zones", () => {
  it("converts U.S. wall-clock time to UTC across DST", () => {
    expect(zonedToUtc("2026-07-01", "09:00", "America/New_York").toISOString()).toBe("2026-07-01T13:00:00.000Z");
    expect(zonedToUtc("2026-12-01", "09:00", "America/New_York").toISOString()).toBe("2026-12-01T14:00:00.000Z");
    expect(zonedToUtc("2026-12-01", "09:00", "Pacific/Honolulu").toISOString()).toBe("2026-12-01T19:00:00.000Z");
  });
  it("builds Monday-start weeks of seven days", () => {
    const w = weekDates("2026-10-17");
    expect(w).toHaveLength(7);
    expect(w[0]).toBe("2026-10-12");
    expect(w[6]).toBe("2026-10-18");
  });
});

describe("analytics math", () => {
  it("computes rates only from metrics that exist", () => {
    const d = (i: number) => new Date(Date.UTC(2026, 9, i));
    const s = summarize([
      { periodStart: d(1), metrics: { profileVisits: 100, newSubscribers: 5, activeSubscribers: 50, churnedSubscribers: 2 }, source: "CSV", retrievedAt: d(2), isDemo: false },
      { periodStart: d(2), metrics: { profileVisits: 100, newSubscribers: 3, activeSubscribers: 51, churnedSubscribers: 2 }, source: "CSV", retrievedAt: d(2), isDemo: false },
    ]);
    expect(s.conversionRate).toBeCloseTo(0.04);
    expect(s.churnRate).toBeCloseTo(4 / 50);
    expect(s.revenuePerSubscriber).toBeNull(); // no revenue column → no fabricated number
    expect(s.acquisitionCostCents).toBeNull();
  });
});

describe("credential encryption", () => {
  it("round-trips and never exposes more than a 4-char hint", () => {
    const enc = encryptSecret("sk-live-abcdef123456");
    expect(enc).not.toContain("abcdef");
    expect(decryptSecret(enc)).toBe("sk-live-abcdef123456");
    expect(secretHint("sk-live-abcdef123456")).toBe("••••3456");
  });
  it("detects tampering", () => {
    const enc = encryptSecret("secret-value");
    const parts = enc.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });
});
