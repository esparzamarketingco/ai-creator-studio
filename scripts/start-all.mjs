// Runs the whole app as one process group, for hosts where a single service is simplest:
// applies pending migrations, then starts the web server and the background worker together.
// If either child exits, the other is stopped and this process exits non-zero so the host restarts it.
import { spawn, spawnSync } from "node:child_process";

function migrate() {
  return spawnSync("node_modules/.bin/prisma", ["migrate", "deploy"], { stdio: "inherit" }).status;
}

// Supabase's shared pooler lives on either aws-0-<region> or aws-1-<region>, and the dashboard is the
// only place that says which. If the configured one rejects us, try the other before giving up.
function otherSupabasePooler(url) {
  const m = /@aws-([01])-([a-z0-9-]+)\.pooler\.supabase\.com/.exec(url ?? "");
  return m ? url.replace(m[0], `@aws-${m[1] === "0" ? "1" : "0"}-${m[2]}.pooler.supabase.com`) : null;
}

let status = migrate();
const alternate = status !== 0 && otherSupabasePooler(process.env.DATABASE_URL);
if (alternate) {
  console.error("[start-all] migrations failed; retrying on the other Supabase pooler host");
  process.env.DATABASE_URL = alternate;
  status = migrate();
}
if (status !== 0) {
  console.error("[start-all] migrations failed; not starting");
  process.exit(status ?? 1);
}

const children = [
  spawn("node_modules/.bin/next", ["start", "-p", process.env.PORT ?? "3000"], { stdio: "inherit" }),
  spawn("node_modules/.bin/tsx", ["scripts/worker.ts"], { stdio: "inherit" }),
];

let stopping = false;
let exitCode = 0;
function stopAll(code) {
  if (stopping) return;
  stopping = true;
  exitCode = code;
  for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill("SIGTERM");
  setTimeout(() => process.exit(exitCode), 10_000).unref();
}

for (const [i, c] of children.entries()) {
  c.on("exit", (code, signal) => {
    if (!stopping) {
      console.error(`[start-all] ${i === 0 ? "web" : "worker"} exited (${signal ?? code}); stopping`);
      stopAll(1);
    }
    if (children.every((x) => x.exitCode !== null || x.signalCode !== null)) process.exit(exitCode);
  });
}
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => stopAll(0));
