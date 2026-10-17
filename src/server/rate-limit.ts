import { db } from "./db";
import { AppError } from "./errors";

/**
 * Fixed-window rate limiter stored in PostgreSQL so it works across instances.
 * Uses a single upsert statement, so concurrent requests are counted atomically.
 */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<void> {
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitBucket" ("key", "count", "windowStart") VALUES (${key}, 1, now())
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimitBucket"."windowStart" < now() - make_interval(secs => ${windowSec}) THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
      "windowStart" = CASE WHEN "RateLimitBucket"."windowStart" < now() - make_interval(secs => ${windowSec}) THEN now() ELSE "RateLimitBucket"."windowStart" END
    RETURNING "count"`;
  if ((rows[0]?.count ?? 0) > limit) {
    throw new AppError("RATE_LIMITED", "Too many attempts. Please wait a few minutes and try again.");
  }
}
