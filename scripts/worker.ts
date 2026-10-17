import { runWorker } from "../src/server/jobs/worker";

runWorker().then(() => process.exit(0));
