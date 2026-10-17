import type { Prisma } from "@prisma/client";
import { db, type Tx } from "../db";

export type JobType = "generation.run" | "publish.run" | "scheduler.tick" | "reminders.daily";

export async function enqueue(
  type: JobType,
  payload: Prisma.InputJsonValue,
  opts: { runAt?: Date; idempotencyKey?: string; maxAttempts?: number } = {},
  client: Tx = db,
) {
  if (opts.idempotencyKey) {
    return client.backgroundJob.upsert({
      where: { idempotencyKey: opts.idempotencyKey },
      create: { type, payload, runAt: opts.runAt ?? new Date(), idempotencyKey: opts.idempotencyKey, maxAttempts: opts.maxAttempts ?? 5 },
      update: {},
    });
  }
  return client.backgroundJob.create({ data: { type, payload, runAt: opts.runAt ?? new Date(), maxAttempts: opts.maxAttempts ?? 5 } });
}

/** Atomically claim the next due job. SKIP LOCKED lets several workers run safely. */
export async function claimNextJob(workerId: string) {
  const rows = await db.$queryRaw<{ id: string }[]>`
    UPDATE "BackgroundJob" SET "status" = 'RUNNING', "lockedAt" = now(), "lockedBy" = ${workerId}, "attempts" = "attempts" + 1, "updatedAt" = now()
    WHERE "id" = (
      SELECT "id" FROM "BackgroundJob"
      WHERE "status" = 'QUEUED' AND "runAt" <= now()
      ORDER BY "runAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING "id"`;
  if (!rows[0]) return null;
  return db.backgroundJob.findUnique({ where: { id: rows[0].id } });
}

export async function completeJob(id: string) {
  await db.backgroundJob.update({ where: { id }, data: { status: "SUCCEEDED", lockedAt: null, lastError: null } });
}

/** Exponential backoff: 30s, 2m, 8m, 32m … */
export const backoffMs = (attempt: number) => 30_000 * 4 ** Math.max(0, attempt - 1);

export async function failJob(id: string, error: string, opts: { retryable: boolean }) {
  const job = await db.backgroundJob.findUniqueOrThrow({ where: { id } });
  const retry = opts.retryable && job.attempts < job.maxAttempts;
  await db.backgroundJob.update({
    where: { id },
    data: {
      status: retry ? "QUEUED" : "FAILED",
      runAt: retry ? new Date(Date.now() + backoffMs(job.attempts)) : job.runAt,
      lockedAt: null,
      lastError: error.slice(0, 2000),
    },
  });
  return { willRetry: retry };
}

/** Return jobs whose worker died mid-run to the queue. */
export async function recoverStaleJobs(staleMs = 15 * 60_000) {
  return db.backgroundJob.updateMany({
    where: { status: "RUNNING", lockedAt: { lt: new Date(Date.now() - staleMs) } },
    data: { status: "QUEUED", lockedAt: null, lockedBy: null },
  });
}
