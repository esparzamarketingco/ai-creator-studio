import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hex64 } from "../../src/server/env";

describe("secret key format", () => {
  const key = randomBytes(32);
  it("accepts 64 hex characters", () => {
    expect(hex64.parse(key.toString("hex").toUpperCase())).toBe(key.toString("hex"));
  });
  it("accepts base64 and base64url, as hosting providers generate", () => {
    expect(hex64.parse(key.toString("base64"))).toBe(key.toString("hex"));
    expect(hex64.parse(key.toString("base64url"))).toBe(key.toString("hex"));
  });
  it("rejects keys that are not 32 bytes", () => {
    for (const bad of ["", "changeme", randomBytes(16).toString("hex"), randomBytes(16).toString("base64"), randomBytes(48).toString("base64")]) {
      expect(hex64.safeParse(bad).success, bad).toBe(false);
    }
  });
});
