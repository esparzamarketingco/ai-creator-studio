import type { Prisma } from "@prisma/client";
import { db, type Tx } from "./db";

export type AuditInput = {
  userId?: string | null;
  workspaceId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  outcome?: "OK" | "BLOCKED" | "FAILED";
  metadata?: Prisma.InputJsonValue;
  ip?: string | null;
};

/** Append-only audit log. Pass a transaction client to log atomically with the change. */
export async function audit(input: AuditInput, client: Tx = db) {
  // Strip anything that looks like a credential before persisting.
  const metadata = JSON.parse(
    JSON.stringify(input.metadata ?? {}, (k, v) => (/secret|password|token|apikey|api_key|credential/i.test(k) ? "[redacted]" : v)),
  );
  await client.auditLog.create({
    data: {
      userId: input.userId ?? null,
      workspaceId: input.workspaceId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      outcome: input.outcome ?? "OK",
      metadata,
      ip: input.ip ?? null,
    },
  });
}
