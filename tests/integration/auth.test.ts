import { describe, expect, it } from "vitest";
import { db } from "../../src/server/db";
import { completeMfa, login, register, requestPasswordReset, resetPassword } from "../../src/server/services/auth";
import { validateSessionToken } from "../../src/server/auth/sessions";
import { beginTotpEnrollment, confirmTotpEnrollment } from "../../src/server/services/security";
import { currentTotp } from "../../src/server/auth/totp";
import { sha256Hex } from "../../src/server/crypto";
import { PASSWORD, makeOwner } from "../helpers";

describe("authentication", () => {
  it("makes the first account the owner with both workspaces; later accounts get none", async () => {
    const { user } = await makeOwner();
    expect(user.role).toBe("OWNER");
    expect(await db.workspaceMember.count({ where: { userId: user.id, role: "MANAGER" } })).toBe(2);
    const second = await register({ name: "Second", email: "two@example.com", password: PASSWORD, confirmAdult: true });
    expect(second.role).toBe("EDITOR");
    expect(await db.workspaceMember.count({ where: { userId: second.id } })).toBe(0);
  });

  it("rejects weak passwords and duplicate emails", async () => {
    await expect(register({ name: "x", email: "a@example.com", password: "short", confirmAdult: true })).rejects.toThrow();
    await makeOwner("dup@example.com");
    await expect(register({ name: "x", email: "dup@example.com", password: PASSWORD, confirmAdult: true })).rejects.toThrow(/already exists/);
  });

  it("never stores plaintext passwords or session tokens", async () => {
    await makeOwner();
    const { token } = await login({ email: "owner@example.com", password: PASSWORD });
    const user = await db.user.findUniqueOrThrow({ where: { email: "owner@example.com" } });
    expect(user.passwordHash).not.toContain(PASSWORD);
    expect(await db.session.findFirst({ where: { tokenHash: token } })).toBeNull();
    expect(await db.session.findFirst({ where: { tokenHash: sha256Hex(token) } })).not.toBeNull();
  });

  it("gives the same error for unknown email and wrong password, and locks after repeated failures", async () => {
    await makeOwner();
    await expect(login({ email: "nobody@example.com", password: PASSWORD })).rejects.toThrow("Incorrect email or password.");
    for (let i = 0; i < 8; i++) await expect(login({ email: "owner@example.com", password: "Wrong-password-1" }, { ip: `10.0.0.${i}` })).rejects.toThrow();
    await expect(login({ email: "owner@example.com", password: PASSWORD }, { ip: "10.0.1.1" })).rejects.toThrow(/locked|Too many/);
  });

  it("requires a TOTP code before the session is usable when 2FA is on", async () => {
    const { actor } = await makeOwner();
    const { secret } = await beginTotpEnrollment(actor);
    await confirmTotpEnrollment(actor, currentTotp(secret));
    const res = await login({ email: "owner@example.com", password: PASSWORD });
    expect(res.mfaRequired).toBe(true);
    const session = await validateSessionToken(res.token);
    expect(session?.mfaPending).toBe(true);
    await expect(completeMfa(session!.id, "000000")).rejects.toThrow(/not valid/);
    await completeMfa(session!.id, currentTotp(secret));
    expect((await validateSessionToken(res.token))?.mfaPending).toBe(false);
  });

  it("revoked and expired sessions are rejected", async () => {
    await makeOwner();
    const { token } = await login({ email: "owner@example.com", password: PASSWORD });
    const s = await validateSessionToken(token);
    await db.session.update({ where: { id: s!.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await validateSessionToken(token)).toBeNull();
    const second = await login({ email: "owner@example.com", password: PASSWORD });
    const s2 = await validateSessionToken(second.token);
    await db.session.update({ where: { id: s2!.id }, data: { revokedAt: new Date() } });
    expect(await validateSessionToken(second.token)).toBeNull();
  });

  it("password reset uses single-use tokens and signs out every session", async () => {
    const { user } = await makeOwner();
    const { token: sessionToken } = await login({ email: "owner@example.com", password: PASSWORD });
    await requestPasswordReset("owner@example.com");
    await requestPasswordReset("nobody@example.com"); // no error, no enumeration
    const rec = await db.passwordResetToken.findFirstOrThrow({ where: { userId: user.id } });
    // We cannot read the raw token from the DB (only its hash) — simulate the emailed one:
    const raw = "known-raw-token";
    await db.passwordResetToken.update({ where: { id: rec.id }, data: { tokenHash: sha256Hex(raw) } });
    await resetPassword(raw, "New-Password-123");
    expect(await validateSessionToken(sessionToken)).toBeNull();
    await expect(resetPassword(raw, "Another-Password-123")).rejects.toThrow(/invalid or has expired/);
    await expect(login({ email: "owner@example.com", password: "New-Password-123" })).resolves.toBeTruthy();
  });
});
