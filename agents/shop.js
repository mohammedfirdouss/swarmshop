import { parseArgs } from "node:util";
import { judge, loadJobs, sha256 } from "./jobs.js";
import { accounts, call, explorer, near } from "./near.js";
import { makeWorkers } from "./workers.js";

const DEADLINE_MINUTES = 30;

const { values } = parseArgs({ options: { mode: { type: "string", default: "sim" } } });
const workers = makeWorkers(values.mode);
const { shop, customer, foreman, workers: workerAccounts } = accounts();

async function attempt(worker, job) {
  try {
    const price = await worker.bid(job);
    if (price === null) return { worker, note: "no bid" };
    const bidTx = await call(workerAccounts[worker.name], shop, "place_bid", { job_id: job.id, price: price.toString() });
    const patch = await worker.patch(job, job.source);
    if (patch === null) return { worker, price, bidTx, note: "no patch" };
    const { pass } = judge(job, patch);
    return { worker, price, bidTx, patch, pass, note: pass ? "tests pass" : "tests fail" };
  } catch (err) {
    return { worker, note: `error: ${err.message.split("\n")[0]}` };
  }
}

console.log(`SwarmShop on ${shop} (mode: ${values.mode})\n`);
for (const spec of loadJobs()) {
  const post = await call(customer, shop, "post_job", { title: spec.title, details: spec.details, minutes: DEADLINE_MINUTES }, spec.budget);
  const job = { ...spec, id: post.value };
  console.log(`job ${job.id} "${job.title}" budget ${near(job.budget)} NEAR`);
  console.log(`  posted   ${explorer(post.hash)}`);

  const results = await Promise.all(workers.map((w) => attempt(w, job)));
  for (const r of results) {
    const price = r.price === undefined ? "" : `bid ${near(r.price)} NEAR`;
    console.log(`  ${r.worker.name.padEnd(12)} ${price.padEnd(16)} ${r.note.padEnd(12)} ${r.bidTx ? explorer(r.bidTx.hash) : ""}`);
  }

  const winner = results.filter((r) => r.pass).sort((a, b) => (a.price < b.price ? -1 : a.price > b.price ? 1 : 0))[0];
  if (winner) {
    const tx = await call(foreman, shop, "award", { job_id: job.id, worker: workerAccounts[winner.worker.name], patch_sha256: sha256(winner.patch) });
    console.log(`  winner   ${winner.worker.name} paid ${near(winner.price)} NEAR, shop keeps ${near(job.budget - winner.price)} NEAR`);
    console.log(`  awarded  ${explorer(tx.hash)}\n`);
  } else {
    const tx = await call(foreman, shop, "refund", { job_id: job.id });
    console.log(`  no passing patch, ${near(job.budget)} NEAR refunded to ${customer}`);
    console.log(`  refunded ${explorer(tx.hash)}\n`);
  }
}
