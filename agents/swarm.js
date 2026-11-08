import { judge, pickWinner, sha256 } from "./jobs.js";
import { call, view } from "./near.js";

const WORK = {
  bid: (e) => ({ bid: { price: e.price, tx: e.tx } }),
  patch: (e) => ({ patch: { file: e.file, content: e.content, sha256: e.sha256 } }),
  test: (e) => ({ test: { pass: e.pass, output: e.output, ms: e.ms } }),
  error: (e) => ({ error: e.message }),
};

export function apply(record, event) {
  const { content, output, ...summary } = event;
  record.events.push(summary);
  if (event.worker && WORK[event.kind]) {
    record.work[event.worker] = { bid: null, patch: null, test: null, error: null, ...record.work[event.worker], ...WORK[event.kind](event) };
  }
  if (event.kind === "award" || event.kind === "refund") record.settleTx = event.tx;
}

export class Board {
  jobs = new Map();
  listeners = new Set();

  constructor(run) {
    this.run = run;
  }

  sync(chainJobs) {
    const started = [];
    for (const chainJob of chainJobs) {
      const record = this.jobs.get(chainJob.id) ?? { work: {}, events: [], postTx: null, settleTx: null, phase: "watching" };
      this.jobs.set(chainJob.id, Object.assign(record, chainJob));
      if (record.phase === "watching" && chainJob.status.state === "Open") started.push(this.start(record));
    }
    return Promise.all(started);
  }

  start(record) {
    record.phase = "working";
    this.emit(record.id, { kind: "job" });
    return this.run(record).then(
      () => {
        record.phase = "settled";
      },
      (err) => {
        record.phase = "watching";
        this.emit(record.id, { kind: "error", message: err.message.split("\n")[0] });
      },
    );
  }

  emit(jobId, event) {
    const full = { ...event, at: new Date().toISOString() };
    apply(this.jobs.get(jobId), full);
    const { kind, at, worker, content, output, ...data } = full;
    for (const listener of this.listeners) listener({ kind, jobId, worker, data, at });
  }
}

async function attempt(worker, job, { shop, workers }, emit) {
  const account = workers[worker.name];
  try {
    if (!job.bids.some((b) => b.worker === account)) {
      const price = await worker.bid(job);
      if (price === null) return emit({ kind: "error", worker: worker.name, message: "declined to bid" });
      const tx = await call(account, shop, "place_bid", { job_id: job.id, price: price.toString() });
      emit({ kind: "bid", worker: worker.name, price: price.toString(), tx: tx.hash });
    }
    const patch = await worker.patch(job);
    if (patch === null) return emit({ kind: "error", worker: worker.name, message: "no usable patch" });
    emit({ kind: "patch", worker: worker.name, ...patch, sha256: sha256(patch.content) });
    const test = await judge(job.acceptance_test, patch);
    emit({ kind: "test", worker: worker.name, ...test });
    return { name: worker.name, account, patch, pass: test.pass };
  } catch (err) {
    emit({ kind: "error", worker: worker.name, message: err.message.split("\n")[0] });
  }
}

async function settledBids(shop, jobId, passing) {
  for (let tries = 1; ; tries++) {
    const { bids } = await view(shop, "get_job", { job_id: jobId });
    if (tries === 3 || passing.every((r) => bids.some((b) => b.worker === r.account))) return bids;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

export async function runSwarm(job, { workers, accounts, emit }) {
  const { shop, foreman } = accounts;
  const expired = BigInt(job.deadline_ns) <= BigInt(Date.now()) * 1_000_000n;
  const results = expired ? [] : await Promise.all(workers.map((w) => attempt(w, job, accounts, emit)));
  const passing = results.filter((r) => r?.pass);
  const winner = pickWinner(passing, await settledBids(shop, job.id, passing));
  if (winner) {
    const tx = await call(foreman, shop, "award", { job_id: job.id, worker: winner.account, patch_sha256: sha256(winner.patch.content) });
    emit({ kind: "award", worker: winner.name, price: winner.price.toString(), tx: tx.hash });
  } else {
    const tx = await call(foreman, shop, "refund", { job_id: job.id });
    emit({ kind: "refund", tx: tx.hash });
  }
}
