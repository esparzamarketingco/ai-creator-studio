// Runs the whole app as one process group, for hosts where a single service is simplest:
// applies pending migrations, then starts the web server and the background worker together.
// If either child exits, the other is stopped and this process exits non-zero so the host restarts it.
import { spawn, spawnSync } from "node:child_process";

const migrate = spawnSync("node_modules/.bin/prisma", ["migrate", "deploy"], { stdio: "inherit" });
if (migrate.status !== 0) {
  console.error("[start-all] migrations failed; not starting");
  process.exit(migrate.status ?? 1);
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
