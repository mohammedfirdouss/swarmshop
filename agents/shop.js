import { parseArgs } from "node:util";
import { loadJobs } from "./jobs.js";
import { accounts, call, explorer, near, view } from "./near.js";
import { Board, runSwarm } from "./swarm.js";
import { makeWorkers } from "./workers.js";

const DEADLINE_MINUTES = 30;

const { values } = parseArgs({ options: { mode: { type: "string", default: "sim" } } });
const workers = makeWorkers(values.mode);
const ids = accounts();
if (!ids.customer) throw new Error("no CUSTOMER_ACCOUNT in .env, run `npm run setup` first");
const board = new Board((job) => runSwarm(job, { workers, accounts: ids, emit: (event) => board.emit(job.id, event) }));

const LINES = {
  bid: (e) => `  ${e.worker.padEnd(12)} bid ${near(e.data.price)} NEAR  ${explorer(e.data.tx)}`,
  test: (e) => `  ${e.worker.padEnd(12)} tests ${e.data.pass ? "pass" : "fail"} (${e.data.ms} ms)`,
  error: (e) => `  ${(e.worker ?? "shop").padEnd(12)} ${e.data.message}`,
  award: (e, job) =>
    `  winner   ${e.worker} paid ${near(e.data.price)} NEAR, shop keeps ${near(BigInt(job.budget) - BigInt(e.data.price))} NEAR\n  awarded  ${explorer(e.data.tx)}\n`,
  refund: (e, job) => `  no passing patch, ${near(job.budget)} NEAR refunded to ${job.customer}\n  refunded ${explorer(e.data.tx)}\n`,
};
board.listeners.add((e) => LINES[e.kind] && console.log(LINES[e.kind](e, board.jobs.get(e.jobId))));

console.log(`SwarmShop on ${ids.shop} (mode: ${values.mode})\n`);
for (const spec of loadJobs()) {
  const args = { title: spec.title, details: spec.details, acceptance_test: spec.test, minutes: DEADLINE_MINUTES };
  const post = await call(ids.customer, ids.shop, "post_job", args, BigInt(spec.budget));
  console.log(`job ${post.value} "${spec.title}" budget ${near(spec.budget)} NEAR\n  posted   ${explorer(post.hash)}`);
  await board.sync([await view(ids.shop, "get_job", { job_id: post.value })]);
}
