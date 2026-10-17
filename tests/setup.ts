import { beforeEach, afterAll } from "vitest";
import { rm } from "node:fs/promises";
import { db } from "../src/server/db";

if (!process.env.DATABASE_URL?.includes("_test")) {
  throw new Error("Refusing to run tests against a non-test database. Use `npm test` (loads .env.test).");
}

beforeEach(async () => {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
});

afterAll(async () => {
  await rm(process.env.STORAGE_DIR ?? "./.storage-test", { recursive: true, force: true });
  await db.$disconnect();
});
