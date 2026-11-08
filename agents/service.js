import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { parseArgs } from "node:util";
import { KeyPair } from "near-api-js";
import { loadJobs } from "./jobs.js";
import { WORKERS, accounts, balance, faucetAccount, listAllJobs, signer, view } from "./near.js";
import { Board, runSwarm } from "./swarm.js";
import { PERSONAS, makeWorkers } from "./workers.js";

const WEB = new URL("../web", import.meta.url).pathname;
const POLL_MS = 3000;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };

const { values } = parseArgs({ options: { mode: { type: "string" }, port: { type: "string", default: process.env.PORT ?? "8788" } } });
const mode = values.mode ?? (process.env.LLM_API_KEY ? "live" : "sim");
const workers = makeWorkers(mode);
const ids = accounts();
const board = new Board((job) => runSwarm(job, { workers, accounts: ids, emit: (event) => board.emit(job.id, event) }));
const clients = new Set();
let stats = {};
const balances = {};

board.listeners.add((event) => {
  console.log(`${event.at} job ${event.jobId} ${event.kind} ${event.worker ?? ""} ${event.data.tx ?? event.data.message ?? ""}`.trimEnd());
  for (const res of clients) res.write(`data: ${JSON.stringify(event)}\n\n`);
});

async function poll() {
  try {
    board.sync(await listAllJobs(ids.shop));
    stats = await view(ids.shop, "stats");
    for (const name of WORKERS) balances[name] = (await balance(ids.workers[name])).toString();
  } catch (err) {
    console.error(`poll failed: ${err.message}`);
  }
  setTimeout(poll, POLL_MS);
}

function state() {
  const jobs = [...board.jobs.values()].sort((a, b) => a.id - b.id);
  const paid = jobs.filter((j) => j.status.state === "Paid");
  return {
    shop: ids.shop,
    network: "testnet",
    foreman: ids.foreman,
    mode,
    workers: WORKERS.map((name) => {
      const account = ids.workers[name];
      const wins = paid.filter((j) => j.status.worker === account);
      return {
        name,
        account,
        handle: PERSONAS[name].handle,
        persona: PERSONAS[name].persona,
        bids: jobs.filter((j) => j.bids.some((b) => b.worker === account)).length,
        wins: wins.length,
        earned: wins.reduce((sum, j) => sum + BigInt(j.status.price), 0n).toString(),
        balance: balances[name] ?? null,
      };
    }),
    stats,
    jobs,
  };
}

const GUEST_FUND = 3n * 10n ** 24n;

async function createAccount() {
  const key = KeyPair.fromRandom("ed25519");
  const stamp = Date.now().toString(36);
  try {
    const accountId = `swarmshop-customer-${stamp}.testnet`;
    await faucetAccount(accountId, key.getPublicKey());
    return { accountId, privateKey: key.toString() };
  } catch (err) {
    const sponsor = process.env.CUSTOMER_ACCOUNT;
    if (!sponsor) throw err;
    const accountId = `guest-${stamp}.${sponsor}`;
    await signer(sponsor).createAccount({ newAccountId: accountId, publicKey: key.getPublicKey(), nearToTransfer: GUEST_FUND });
    return { accountId, privateKey: key.toString(), sponsor };
  }
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function serveStatic(pathname, res) {
  const file = join(WEB, normalize(pathname === "/" ? "/index.html" : pathname));
  if (!file.startsWith(WEB)) return json(res, 404, { error: "not found" });
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    json(res, 404, { error: "not found" });
  }
}

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  const route = `${req.method} ${pathname}`;
  try {
    if (route === "GET /api/state") return json(res, 200, state());
    if (route === "GET /api/examples") return json(res, 200, loadJobs());
    if (route === "POST /api/accounts") return json(res, 200, await createAccount());
    if (route === "GET /api/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      res.write(":ok\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (req.method === "GET") return serveStatic(pathname, res);
    json(res, 404, { error: "not found" });
  } catch (err) {
    json(res, 502, { error: err.message });
  }
}).listen(Number(values.port), () => console.log(`SwarmShop ${ids.shop} (mode: ${mode}) on http://localhost:${values.port}`));

setInterval(() => {
  for (const res of clients) res.write(":ping\n\n");
}, 15_000);
poll();
