import { db, type Tx } from "../db";
import type { Actor } from "../auth/actor";

export async function notify(
  input: { userId: string; type: string; title: string; body?: string; link?: string; dedupeKey?: string },
  client: Tx = db,
) {
  if (input.dedupeKey) {
    await client.notification.upsert({
      where: { dedupeKey: input.dedupeKey },
      create: { ...input, body: input.body ?? "" },
      update: {},
    });
    return;
  }
  await client.notification.create({ data: { ...input, body: input.body ?? "" } });
}

/** Notify every manager of a workspace. */
export async function notifyWorkspaceManagers(workspaceId: string, n: Omit<Parameters<typeof notify>[0], "userId">, client: Tx = db) {
  const managers = await client.workspaceMember.findMany({ where: { workspaceId, role: "MANAGER" }, select: { userId: true } });
  for (const m of managers) await notify({ ...n, userId: m.userId, dedupeKey: n.dedupeKey ? `${n.dedupeKey}:${m.userId}` : undefined }, client);
}

export async function listNotifications(actor: Actor, limit = 30) {
  const [items, unread] = await Promise.all([
    db.notification.findMany({ where: { userId: actor.userId }, orderBy: { createdAt: "desc" }, take: limit }),
    db.notification.count({ where: { userId: actor.userId, readAt: null } }),
  ]);
  return { items, unread };
}

export async function markNotificationsRead(actor: Actor, ids?: string[]) {
  await db.notification.updateMany({
    where: { userId: actor.userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
}
