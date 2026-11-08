import { spawn } from "node:child_process";
import { loadJobs } from "./jobs.js";
import { accounts, call, near, view, yocto } from "./near.js";

const PORT = 8799;
const TIMEOUT_MS = 180_000;
const DEADLINE_MINUTES = 30;

const { shop, customer, workers } = accounts();
if (!customer) throw new Error("no CUSTOMER_ACCOUNT in .env, run `npm run setup` first");
const example = loadJobs()[0];
const posts = [
  { title: example.title, details: example.details, test: example.test, budget: "1", want: { state: "Paid", worker: "worker-bolt", price: "0.3" } },
  { title: `unscripted bug ${Date.now().toString(36)}`, details: "no sim worker knows this one", test: example.test, budget: "0.5", want: { state: "Refunded" } },
];

let failures = 0;
const check = (ok, message) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
  if (!ok) failures++;
};
const api = async (path) => (await fetch(`http://localhost:${PORT}${path}`)).json();
async function until(probe, what) {
  for (const end = Date.now() + TIMEOUT_MS; Date.now() < end; await new Promise((r) => setTimeout(r, 2000))) {
    const value = await probe().catch(() => null);
    if (value) return value;
  }
  throw new Error(`timed out waiting for ${what}`);
}

const service = spawn(process.execPath, [new URL("./service.js", import.meta.url).pathname, "--mode", "sim", "--port", String(PORT)], {
  stdio: ["ignore", "inherit", "inherit"],
});
try {
  await until(() => api("/api/state"), "the service to start");
  for (const p of posts) {
    const args = { title: p.title, details: p.details, acceptance_test: p.test, minutes: DEADLINE_MINUTES };
    p.id = (await call(customer, shop, "post_job", args, yocto(p.budget))).value;
    console.log(`posted job ${p.id} "${p.title}" with ${p.budget} NEAR`);
  }
  for (const p of posts) {
    const entry = await until(async () => (await api("/api/state")).jobs.find((j) => j.id === p.id && j.phase === "settled"), `job ${p.id} to settle`);
    const onChain = await view(shop, "get_job", { job_id: p.id });
    check(onChain.status.state === p.want.state, `job ${p.id} is ${p.want.state} on chain (chain says ${onChain.status.state})`);
    if (p.want.state === "Paid") {
      check(onChain.status.worker === workers[p.want.worker], `job ${p.id} paid to ${p.want.worker} (chain says ${onChain.status.worker})`);
      check(BigInt(onChain.status.price) === yocto(p.want.price), `job ${p.id} price is ${p.want.price} NEAR (chain says ${near(onChain.status.price)})`);
    }
    const kinds = entry.events.map((e) => e.kind);
    check(Object.keys(entry.work).length === 3, `job ${p.id} has work from 3 workers in /api/state`);
    check(Object.values(entry.work).every((w) => w.bid?.tx && w.patch?.sha256 && typeof w.test?.pass === "boolean"), `job ${p.id} work has bid tx, patch hash and test result per worker`);
    check(kinds[0] === "job" && kinds.filter((k) => k === "bid").length === 3, `job ${p.id} events start with job and hold 3 bids`);
    check(kinds.at(-1) === (p.want.state === "Paid" ? "award" : "refund") && entry.settleTx, `job ${p.id} events end in ${p.want.state === "Paid" ? "award" : "refund"} with tx ${entry.settleTx}`);
  }
} finally {
  service.kill();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
