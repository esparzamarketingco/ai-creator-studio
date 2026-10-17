import { db } from "../db";
import { AppError } from "../errors";
import { audit } from "../audit";
import { storage } from "../media/storage";
import { hashPassword, passwordSchema, verifyPassword } from "../auth/password";
import { revokeAllSessions } from "../auth/sessions";
import { newTotpSecret, totpUri, verifyTotp } from "../auth/totp";
import { notify } from "./notifications";
import type { Actor } from "../auth/actor";

export async function listSessions(actor: Actor) {
  return db.session.findMany({
    where: { userId: actor.userId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true, mfaPending: true },
    orderBy: { lastSeenAt: "desc" },
  });
}

export async function revokeOwnSession(actor: Actor, sessionId: string) {
  const s = await db.session.findFirst({ where: { id: sessionId, userId: actor.userId } });
  if (!s) throw new AppError("NOT_FOUND", "Session not found.");
  await db.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
  await audit({ userId: actor.userId, action: "security.session_revoked", entityType: "Session", entityId: sessionId, ip: actor.ip });
}

export async function revokeOtherSessions(actor: Actor) {
  await revokeAllSessions(actor.userId, actor.sessionId);
  await audit({ userId: actor.userId, action: "security.other_sessions_revoked", entityType: "User", entityId: actor.userId, ip: actor.ip });
}

export async function changePassword(actor: Actor, current: string, next: string) {
  const pw = passwordSchema.parse(next);
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.userId } });
  if (!(await verifyPassword(current, user.passwordHash))) throw new AppError("VALIDATION", "Your current password is incorrect.");
  await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(pw) } });
  await revokeAllSessions(user.id, actor.sessionId);
  await audit({ userId: user.id, action: "security.password_changed", entityType: "User", entityId: user.id, ip: actor.ip });
  await notify({ userId: user.id, type: "security", title: "Password changed", body: "Other sessions were signed out." });
}

/** Step 1: create a pending secret. It is stored encrypted and only enabled after a valid code. */
export async function beginTotpEnrollment(actor: Actor) {
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.userId } });
  if (user.totpEnabled) throw new AppError("CONFLICT", "Two-factor authentication is already on.");
  const { secret, enc } = newTotpSecret();
  await db.user.update({ where: { id: user.id }, data: { totpSecretEnc: enc } });
  return { secret, uri: totpUri(user.email, secret) };
}

export async function confirmTotpEnrollment(actor: Actor, code: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.userId } });
  if (!user.totpSecretEnc || !verifyTotp(code, user.totpSecretEnc)) throw new AppError("VALIDATION", "That code is not valid. Try the current code from your app.");
  await db.user.update({ where: { id: user.id }, data: { totpEnabled: true } });
  await audit({ userId: user.id, action: "security.mfa_enabled", entityType: "User", entityId: user.id, ip: actor.ip });
  await notify({ userId: user.id, type: "security", title: "Two-factor authentication enabled" });
}

export async function disableTotp(actor: Actor, password: string, code: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.userId } });
  if (!user.totpEnabled || !user.totpSecretEnc) throw new AppError("CONFLICT", "Two-factor authentication is off.");
  if (!(await verifyPassword(password, user.passwordHash)) || !verifyTotp(code, user.totpSecretEnc)) throw new AppError("VALIDATION", "Password or code is incorrect.");
  await db.user.update({ where: { id: user.id }, data: { totpEnabled: false, totpSecretEnc: null } });
  await audit({ userId: user.id, action: "security.mfa_disabled", entityType: "User", entityId: user.id, ip: actor.ip });
  await notify({ userId: user.id, type: "security", title: "Two-factor authentication disabled" });
}

/** Attest 18+ and authorization for the restricted workspace (re-authenticated with password). */
export async function attestAdultAccess(actor: Actor, password: string, confirm: boolean) {
  if (!confirm) throw new AppError("VALIDATION", "Tick the confirmation to continue.");
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.userId } });
  if (!(await verifyPassword(password, user.passwordHash))) throw new AppError("VALIDATION", "Password is incorrect.");
  await db.user.update({ where: { id: user.id }, data: { adultAccessAttestedAt: new Date() } });
  await audit({ userId: user.id, action: "security.adult_access_attested", entityType: "User", entityId: user.id, ip: actor.ip });
}

export async function withdrawAdultAccess(actor: Actor) {
  await db.user.update({ where: { id: actor.userId }, data: { adultAccessAttestedAt: null } });
  await audit({ userId: actor.userId, action: "security.adult_access_withdrawn", entityType: "User", entityId: actor.userId, ip: actor.ip });
}

export async function setSecurityNotifications(actor: Actor, on: boolean) {
  await db.user.update({ where: { id: actor.userId }, data: { securityNotifications: on } });
}

export async function listAuditLog(actor: Actor, opts: { take?: number; action?: string } = {}) {
  const workspaceIds = (await db.workspaceMember.findMany({ where: { userId: actor.userId }, select: { workspaceId: true } })).map((m) => m.workspaceId);
  return db.auditLog.findMany({
    where: { OR: [{ userId: actor.userId }, { workspaceId: { in: workspaceIds } }], ...(opts.action ? { action: { startsWith: opts.action } } : {}) },
    orderBy: { createdAt: "desc" },
    take: Math.min(opts.take ?? 100, 500),
    include: { user: { select: { name: true } } },
  });
}

/** Machine-readable export of the account's data. Secrets and password hashes are excluded. */
export async function exportAccountData(actor: Actor) {
  const user = await db.user.findUniqueOrThrow({
    where: { id: actor.userId },
    select: { id: true, email: true, name: true, role: true, createdAt: true, emailVerifiedAt: true, totpEnabled: true, adultAccessAttestedAt: true },
  });
  const profile = await db.creatorProfile.findUnique({ where: { userId: actor.userId }, include: { characters: true, likenessRefs: { select: { id: true, label: true, subjectName: true, relationship: true, consentStatement: true, consentConfirmedAt: true, revokedAt: true, sha256: true, createdAt: true } } } });
  const workspaceIds = (await db.workspaceMember.findMany({ where: { userId: actor.userId, role: "MANAGER" }, select: { workspaceId: true } })).map((m) => m.workspaceId);
  const [concepts, assets, approvals, schedules, snapshots, auditLog] = await Promise.all([
    db.contentConcept.findMany({ where: { workspaceId: { in: workspaceIds } }, include: { prompts: true } }),
    db.mediaAsset.findMany({ where: { workspaceId: { in: workspaceIds } }, include: { versions: { select: { id: true, versionNumber: true, sha256: true, mimeType: true, sizeBytes: true, source: true, isSimulated: true, createdAt: true } } } }),
    db.approvalRecord.findMany({ where: { decidedById: actor.userId } }),
    db.publishingSchedule.findMany({ where: { workspaceId: { in: workspaceIds } }, include: { post: true, attempts_log: true } }),
    db.analyticsSnapshot.findMany({ where: { workspaceId: { in: workspaceIds } } }),
    db.auditLog.findMany({ where: { userId: actor.userId }, orderBy: { createdAt: "desc" }, take: 5000 }),
  ]);
  await audit({ userId: actor.userId, action: "security.data_exported", entityType: "User", entityId: actor.userId, ip: actor.ip });
  return { exportedAt: new Date().toISOString(), note: "Media files are not embedded; download them from the Library.", user, profile, concepts, assets, approvals, schedules, analyticsSnapshots: snapshots, auditLog };
}

/** Permanently delete the account, its private media files and (if sole manager) its workspaces. */
export async function deleteAccount(actor: Actor, password: string, confirmation: string) {
  if (confirmation !== "DELETE MY ACCOUNT") throw new AppError("VALIDATION", 'Type "DELETE MY ACCOUNT" to confirm.');
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.userId }, include: { creatorProfile: { include: { likenessRefs: true } } } });
  if (!(await verifyPassword(password, user.passwordHash))) throw new AppError("VALIDATION", "Password is incorrect.");
  const memberships = await db.workspaceMember.findMany({ where: { userId: user.id, role: "MANAGER" } });
  const soleWorkspaces: string[] = [];
  for (const m of memberships) {
    const managers = await db.workspaceMember.count({ where: { workspaceId: m.workspaceId, role: "MANAGER" } });
    if (managers === 1) soleWorkspaces.push(m.workspaceId);
  }
  const keys = [
    ...(await db.assetVersion.findMany({ where: { asset: { workspaceId: { in: soleWorkspaces } } }, select: { storageKey: true } })).map((v) => v.storageKey),
    ...(user.creatorProfile?.likenessRefs.map((r) => r.storageKey) ?? []),
    ...[user.creatorProfile?.profilePhotoKey, user.creatorProfile?.bannerKey].filter((k): k is string => Boolean(k)),
  ];
  await audit({ userId: null, action: "security.account_deleted", entityType: "User", entityId: user.id, ip: actor.ip, metadata: { workspacesDeleted: soleWorkspaces.length, files: keys.length } });
  await db.$transaction([
    db.approvalRecord.deleteMany({ where: { decidedById: user.id } }),
    db.workspace.deleteMany({ where: { id: { in: soleWorkspaces } } }),
    db.user.delete({ where: { id: user.id } }),
  ]);
  for (const k of keys) await storage().delete(k).catch(() => undefined);
}
