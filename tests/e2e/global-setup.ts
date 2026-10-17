import { execSync } from "node:child_process";

export default async function globalSetup() {
  if (!process.env.DATABASE_URL?.includes("_test")) throw new Error("E2E tests must use the test database (npm run test:e2e).");
  execSync("npx prisma migrate deploy", { stdio: "inherit" });
  execSync(`psql "${process.env.DATABASE_URL}" -q -c "DO \\$\\$ DECLARE r record; BEGIN FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' LOOP EXECUTE 'TRUNCATE \\"' || r.tablename || '\\" CASCADE'; END LOOP; END \\$\\$;"`, { stdio: "inherit" });
  execSync("npx tsx prisma/seed.ts", { stdio: "inherit", env: { ...process.env, NODE_ENV: "test", SEED_EMAIL: "e2e@example.com", SEED_PASSWORD: "E2e-Test-Password-1" } });
}
