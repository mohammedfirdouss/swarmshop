import { readFileSync } from "node:fs";
import { judge, loadJobs, sha256 } from "./jobs.js";
import { WORKER_FUND, accounts, balance, near, view, yocto } from "./near.js";

const EXPECTED = {
  "01-slugify-digits": { state: "Paid", worker: "worker-bolt", price: "0.3" },
  "02-truncate-length": { state: "Paid", worker: "worker-cid", price: "0.5" },
  "03-duration-compound": { state: "Paid", worker: "worker-ace", price: "1.05" },
  "04-near-precision": { state: "Refunded" },
};
const GAS_ALLOWANCE_PER_BID = yocto("0.01");

const { shop, workers } = accounts();
let failures = 0;
const check = (ok, message) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
  if (!ok) failures++;
};

const chainJobs = [];
for (let from = 0; ; from += 100) {
  const page = await view(shop, "list_jobs", { from, limit: 100 });
  chainJobs.push(...page);
  if (page.length < 100) break;
}
console.log(`read ${chainJobs.length} jobs from ${shop}\n`);

for (const job of loadJobs()) {
  const want = EXPECTED[job.slug];
  const onChain = chainJobs.filter((j) => j.title === job.title).at(-1);
  if (!onChain) {
    check(false, `${job.slug} is on chain`);
    continue;
  }
  const { status } = onChain;
  check(BigInt(onChain.budget) === job.budget, `${job.slug} job ${onChain.id} budget is ${near(job.budget)} NEAR`);
  check(status.state === want.state, `${job.slug} job ${onChain.id} is ${want.state} (chain says ${status.state})`);
  if (want.state !== "Paid" || status.state !== "Paid") continue;
  check(status.worker === workers[want.worker], `${job.slug} paid to ${want.worker} (chain says ${status.worker})`);
  check(BigInt(status.price) === yocto(want.price), `${job.slug} price is ${want.price} NEAR (chain says ${near(status.price)})`);
  const patch = readFileSync(new URL(`./sim/${job.slug}/${want.worker}.js`, import.meta.url), "utf8");
  check(status.patch_sha256 === sha256(patch), `${job.slug} on-chain patch hash matches ${want.worker}'s patch`);
  check(judge(job, patch).pass, `${job.slug} that patch passes the tests when re-run`);
}

const stats = await view(shop, "stats");
const paid = chainJobs.filter((j) => j.status.state === "Paid");
const sum = (xs) => xs.reduce((a, b) => a + b, 0n);
const paidOut = sum(paid.map((j) => BigInt(j.status.price)));
const margin = sum(paid.map((j) => BigInt(j.budget) - BigInt(j.status.price)));
console.log();
check(stats.jobs_posted === chainJobs.length, `stats.jobs_posted is ${chainJobs.length}`);
check(stats.jobs_paid === paid.length, `stats.jobs_paid is ${paid.length}`);
check(stats.jobs_refunded === chainJobs.filter((j) => j.status.state === "Refunded").length, `stats.jobs_refunded matches the jobs`);
check(BigInt(stats.volume) === sum(chainJobs.map((j) => BigInt(j.budget))), `stats.volume ${near(stats.volume)} NEAR is the sum of budgets`);
check(BigInt(stats.paid_to_workers) === paidOut, `stats.paid_to_workers ${near(stats.paid_to_workers)} NEAR is the sum of winning bids`);
check(BigInt(stats.margin) === margin, `stats.margin ${near(stats.margin)} NEAR is budget minus price over paid jobs`);

console.log();
for (const [name, accountId] of Object.entries(workers)) {
  const earned = sum(paid.filter((j) => j.status.worker === accountId).map((j) => BigInt(j.status.price)));
  const bids = chainJobs.flatMap((j) => j.bids).filter((b) => b.worker === accountId).length;
  const now = await balance(accountId);
  const floor = WORKER_FUND + earned - BigInt(bids) * GAS_ALLOWANCE_PER_BID;
  check(
    earned > 0n && now > WORKER_FUND && now >= floor,
    `${name} balance ${near(now)} NEAR is up from its ${near(WORKER_FUND)} NEAR start and covers ${near(earned)} NEAR earned over ${bids} bids`,
  );
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
