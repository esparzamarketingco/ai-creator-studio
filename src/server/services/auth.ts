import { z } from "zod";
import { db } from "../db";
import { env } from "../env";
import { AppError } from "../errors";
import { audit } from "../audit";
import { randomToken, sha256Hex } from "../crypto";
import { rateLimit } from "../rate-limit";
import { sendEmail } from "../mailer";
import { dummyHash, hashPassword, passwordSchema, verifyPassword } from "../auth/password";
import { createSession, revokeAllSessions, revokeSession } from "../auth/sessions";
import { verifyTotp } from "../auth/totp";
import { notify } from "./notifications";
import { DEFAULT_WORKSPACES } from "./workspace-defaults";

export const registerSchema = z.object({
  name: z.string().trim().min(1, "Required").max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: passwordSchema,
  confirmAdult: z.literal(true, { errorMap: () => ({ message: "You must confirm you are 18 or older" }) }),
});

const MAX_FAILED = 8;
const LOCK_MS = 15 * 60_000;

type ReqMeta = { ip?: string | null; userAgent?: string | null };

/**
 * Register. The first account becomes the OWNER and receives both workspaces.
 * Later sign-ups require ALLOW_REGISTRATION=true and get no workspace access until invited.
 */
export async function register(input: z.input<typeof registerSchema>, meta: ReqMeta = {}) {
  const data = registerSchema.parse(input);
  await rateLimit(`register:${meta.ip ?? "unknown"}`, 10, 3600);
  const userCount = await db.user.count();
  if (userCount > 0 && env().ALLOW_REGISTRATION !== "true") throw new AppError("FORBIDDEN", "Registration is closed.");
  if (await db.user.findUnique({ where: { email: data.email } })) {
    throw new AppError("CONFLICT", "An account with this email already exists.");
  }
  const isFirst = userCount === 0;
  const user = await db.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: { email: data.email, name: data.name, passwordHash: await hashPassword(data.password), role: isFirst ? "OWNER" : "EDITOR" },
    });
    await tx.creatorProfile.create({ data: { userId: u.id, displayName: data.name } });
    if (isFirst) {
      for (const ws of DEFAULT_WORKSPACES) {
        const existing = await tx.workspace.findUnique({ where: { slug: ws.slug } });
        const w = existing ?? (await tx.workspace.create({ data: ws }));
        await tx.workspaceMember.create({ data: { workspaceId: w.id, userId: u.id, role: "MANAGER" } });
      }
    }
    await audit({ userId: u.id, action: "auth.register", entityType: "User", entityId: u.id, ip: meta.ip, metadata: { owner: isFirst } }, tx);
    return u;
  });
  await sendVerificationEmail(user.id);
  return user;
}

export async function sendVerificationEmail(userId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.emailVerifiedAt) return;
  const token = randomToken(32);
  await db.emailVerificationToken.create({ data: { userId, tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + 48 * 3600_000) } });
  await sendEmail(user.email, "Verify your AI Creator Studio email", `Verify your email: ${env().APP_URL}/verify-email?token=${token}`);
}

export async function verifyEmail(token: string) {
  const rec = await db.emailVerificationToken.findUnique({ where: { tokenHash: sha256Hex(token) } });
  if (!rec || rec.usedAt || rec.expiresAt < new Date()) throw new AppError("VALIDATION", "This verification link is invalid or has expired.");
  await db.$transaction([
    db.emailVerificationToken.update({ where: { id: rec.id }, data: { usedAt: new Date() } }),
    db.user.update({ where: { id: rec.userId }, data: { emailVerifiedAt: new Date() } }),
  ]);
  await audit({ userId: rec.userId, action: "auth.email_verified", entityType: "User", entityId: rec.userId });
}

export async function login(input: { email: string; password: string }, meta: ReqMeta = {}) {
  const email = String(input.email ?? "").trim().toLowerCase();
  await rateLimit(`login:ip:${meta.ip ?? "unknown"}`, 30, 900);
  await rateLimit(`login:email:${email}`, 10, 900);
  const user = await db.user.findUnique({ where: { email } });
  const generic = new AppError("UNAUTHENTICATED", "Incorrect email or password.");
  if (!user) {
    await verifyPassword(String(input.password ?? ""), dummyHash()); // equalize timing
    await audit({ action: "auth.login", entityType: "User", outcome: "FAILED", ip: meta.ip, metadata: { reason: "unknown_email" } });
    throw generic;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await audit({ userId: user.id, action: "auth.login", entityType: "User", entityId: user.id, outcome: "BLOCKED", ip: meta.ip, metadata: { reason: "locked" } });
    throw new AppError("RATE_LIMITED", "This account is temporarily locked after repeated failed sign-ins. Try again in 15 minutes.");
  }
  if (!(await verifyPassword(String(input.password ?? ""), user.passwordHash))) {
    const failed = user.failedLoginCount + 1;
    await db.user.update({
      where: { id: user.id },
      data: { failedLoginCount: failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MS) : null },
    });
    await audit({ userId: user.id, action: "auth.login", entityType: "User", entityId: user.id, outcome: "FAILED", ip: meta.ip, metadata: { reason: "bad_password" } });
    if (failed >= MAX_FAILED) {
      await notify({ userId: user.id, type: "security", title: "Account locked after failed sign-ins", body: `From IP ${meta.ip ?? "unknown"}.` });
    }
    throw generic;
  }
  await db.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
  const { token, session } = await createSession(user.id, { mfaPending: user.totpEnabled, ...meta });
  await audit({ userId: user.id, action: "auth.login", entityType: "Session", entityId: session.id, ip: meta.ip, metadata: { mfaPending: user.totpEnabled } });
  if (user.securityNotifications && !user.totpEnabled) {
    await notify({ userId: user.id, type: "security", title: "New sign-in", body: `${meta.userAgent?.slice(0, 80) ?? "Unknown device"} · ${meta.ip ?? "unknown IP"}` });
  }
  return { token, mfaRequired: user.totpEnabled };
}

export async function completeMfa(sessionId: string, code: string, meta: ReqMeta = {}) {
  const session = await db.session.findUnique({ where: { id: sessionId }, include: { user: true } });
  if (!session || !session.mfaPending || session.revokedAt) throw new AppError("UNAUTHENTICATED", "Your sign-in expired. Please sign in again.");
  await rateLimit(`mfa:${sessionId}`, 6, 900);
  if (!session.user.totpSecretEnc || !verifyTotp(code, session.user.totpSecretEnc)) {
    await audit({ userId: session.userId, action: "auth.mfa", entityType: "Session", entityId: sessionId, outcome: "FAILED", ip: meta.ip });
    throw new AppError("VALIDATION", "That code is not valid. Check your authenticator app and try again.");
  }
  await db.session.update({ where: { id: sessionId }, data: { mfaPending: false } });
  await audit({ userId: session.userId, action: "auth.mfa", entityType: "Session", entityId: sessionId, ip: meta.ip });
  if (session.user.securityNotifications) {
    await notify({ userId: session.userId, type: "security", title: "New sign-in (2FA verified)", body: `${meta.userAgent?.slice(0, 80) ?? "Unknown device"} · ${meta.ip ?? "unknown IP"}` });
  }
}

export async function logout(sessionId: string) {
  const s = await db.session.findUnique({ where: { id: sessionId } });
  if (!s) return;
  await revokeSession(sessionId);
  await audit({ userId: s.userId, action: "auth.logout", entityType: "Session", entityId: sessionId });
}

/** Always responds the same way whether or not the email exists (no account enumeration). */
export async function requestPasswordReset(emailRaw: string, meta: ReqMeta = {}) {
  const email = emailRaw.trim().toLowerCase();
  await rateLimit(`reset:${meta.ip ?? "unknown"}`, 5, 3600);
  const user = await db.user.findUnique({ where: { email } });
  if (!user) return;
  const token = randomToken(32);
  await db.passwordResetToken.create({ data: { userId: user.id, tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + 3600_000) } });
  await sendEmail(user.email, "Reset your AI Creator Studio password", `Reset your password (valid for 1 hour): ${env().APP_URL}/reset-password?token=${token}\n\nIf you did not request this, ignore this email.`);
  await audit({ userId: user.id, action: "auth.password_reset_requested", entityType: "User", entityId: user.id, ip: meta.ip });
}

export async function resetPassword(token: string, newPassword: string, meta: ReqMeta = {}) {
  const pw = passwordSchema.parse(newPassword);
  const rec = await db.passwordResetToken.findUnique({ where: { tokenHash: sha256Hex(token) } });
  if (!rec || rec.usedAt || rec.expiresAt < new Date()) throw new AppError("VALIDATION", "This reset link is invalid or has expired.");
  await db.$transaction([
    db.passwordResetToken.update({ where: { id: rec.id }, data: { usedAt: new Date() } }),
    db.user.update({ where: { id: rec.userId }, data: { passwordHash: await hashPassword(pw), failedLoginCount: 0, lockedUntil: null } }),
  ]);
  await revokeAllSessions(rec.userId);
  await audit({ userId: rec.userId, action: "auth.password_reset", entityType: "User", entityId: rec.userId, ip: meta.ip });
  await notify({ userId: rec.userId, type: "security", title: "Your password was reset", body: "All other sessions were signed out." });
}
