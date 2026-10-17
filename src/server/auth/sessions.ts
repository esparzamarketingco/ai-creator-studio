import { db } from "../db";
import { randomToken, sha256Hex } from "../crypto";

export const SESSION_COOKIE = "acs_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // sliding 7 days
const TOUCH_INTERVAL_MS = 10 * 60 * 1000;

export async function createSession(userId: string, opts: { mfaPending: boolean; ip?: string | null; userAgent?: string | null }) {
  const token = randomToken(32);
  const session = await db.session.create({
    data: {
      userId,
      tokenHash: sha256Hex(token),
      mfaPending: opts.mfaPending,
      ip: opts.ip ?? null,
      userAgent: opts.userAgent?.slice(0, 300) ?? null,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return { token, session };
}

/** Resolve a raw cookie token to a live session + user, or null. Extends sliding expiry. */
export async function validateSessionToken(token: string | undefined | null) {
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: sha256Hex(token) },
    include: { user: true },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  if (Date.now() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
    });
  }
  return session;
}

export async function revokeSession(sessionId: string) {
  await db.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string) {
  await db.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
}
