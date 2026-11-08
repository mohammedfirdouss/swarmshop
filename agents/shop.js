import { parseArgs } from "node:util";
import { judge, loadJobs, pickWinner, sha256 } from "./jobs.js";
import { accounts, call, explorer, near, view } from "./near.js";
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

async function chainBids(jobId, passing) {
  for (let tries = 1; ; tries++) {
    const { bids } = await view(shop, "get_job", { job_id: jobId });
    if (tries === 3 || passing.every((r) => bids.some((b) => b.worker === r.account))) return bids;
    await new Promise((resolve) => setTimeout(resolve, 2000));
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

  const passing = results.filter((r) => r.pass).map((r) => ({ ...r, account: workerAccounts[r.worker.name] }));
  const winner = pickWinner(passing, await chainBids(job.id, passing));
  if (winner) {
    const tx = await call(foreman, shop, "award", { job_id: job.id, worker: winner.account, patch_sha256: sha256(winner.patch) });
    console.log(`  winner   ${winner.worker.name} paid ${near(winner.price)} NEAR, shop keeps ${near(job.budget - winner.price)} NEAR`);
    console.log(`  awarded  ${explorer(tx.hash)}\n`);
  } else {
    const tx = await call(foreman, shop, "refund", { job_id: job.id });
    console.log(`  no passing patch, ${near(job.budget)} NEAR refunded to ${customer}`);
    console.log(`  refunded ${explorer(tx.hash)}\n`);
  }
}
