import { hostname } from "node:os";
import { randomToken } from "../crypto";
import { env } from "../env";
import { claimNextJob, completeJob, failJob, recoverStaleJobs, enqueue } from "./queue";
import { runGenerationJob } from "../services/generation";
import { executePublication, schedulerTick } from "../services/publishing";
import { dailyReminders } from "../services/reminders";

const handlers: Record<string, (payload: Record<string, string>) => Promise<void>> = {
  "generation.run": async (p) => runGenerationJob(p.generationJobId),
  "publish.run": async (p) => {
    await executePublication(p.scheduleId);
  },
  "scheduler.tick": async () => {
    await schedulerTick();
  },
  "reminders.daily": async () => dailyReminders(),
};

/** Process due jobs until the queue is empty. Returns how many ran. */
export async function drainQueue(workerId = `worker-${hostname()}-${randomToken(4)}`, max = 100) {
  let n = 0;
  for (; n < max; n++) {
    const job = await claimNextJob(workerId);
    if (!job) break;
    const handler = handlers[job.type];
    try {
      if (!handler) throw Object.assign(new Error(`No handler for ${job.type}`), { retryable: false });
      await handler(job.payload as Record<string, string>);
      await completeJob(job.id);
    } catch (err) {
      const retryable = (err as { retryable?: boolean }).retryable !== false;
      await failJob(job.id, (err as Error).message, { retryable });
    }
  }
  return n;
}

export async function runWorker() {
  const id = `worker-${hostname()}-${randomToken(4)}`;
  const poll = env().WORKER_POLL_MS;
  console.info(`[worker] ${id} started (poll ${poll}ms)`);
  let lastTick = 0;
  let lastDaily = "";
  let stopping = false;
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { stopping = true; console.info("[worker] stopping…"); });
  while (!stopping) {
    try {
      if (Date.now() - lastTick > 30_000) {
        lastTick = Date.now();
        await schedulerTick();
        await recoverStaleJobs();
        const day = new Date().toISOString().slice(0, 10);
        if (day !== lastDaily && new Date().getUTCHours() >= 14) { // ~10am Eastern
          lastDaily = day;
          await enqueue("reminders.daily", {}, { idempotencyKey: `reminders:${day}` });
        }
      }
      const ran = await drainQueue(id, 20);
      if (!ran) await new Promise((r) => setTimeout(r, poll));
    } catch (err) {
      console.error("[worker] loop error", err);
      await new Promise((r) => setTimeout(r, poll));
    }
  }
}
