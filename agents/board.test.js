import { test } from "node:test";
import assert from "node:assert/strict";
import { Board } from "./swarm.js";

const open = (id) => ({ id, title: `job ${id}`, budget: "1000", bids: [], status: { state: "Open" } });
const paid = (id) => ({ ...open(id), status: { state: "Paid", worker: "ace", price: "300" } });

function boardWith(run) {
  const calls = [];
  const board = new Board(async (job) => {
    calls.push(job.id);
    await run?.(job, (event) => board.emit(job.id, event));
  });
  return { board, calls };
}

test("an open job is run once, however often the chain is polled", async () => {
  const { board, calls } = boardWith();
  await board.sync([open(1), paid(2)]);
  await board.sync([open(1), paid(2)]);
  assert.deepEqual(calls, [1]);
  assert.equal(board.jobs.get(1).phase, "settled");
  assert.equal(board.jobs.get(2).phase, "watching");
});

test("a run that throws is reported and retried on the next poll", async () => {
  let attempts = 0;
  const { board, calls } = boardWith(async () => {
    if (attempts++ === 0) throw new Error("rpc down\nstack");
  });
  await board.sync([open(1)]);
  assert.deepEqual(board.jobs.get(1).events.map((e) => e.kind), ["job", "error"]);
  assert.equal(board.jobs.get(1).events[1].message, "rpc down");
  await board.sync([open(1)]);
  assert.deepEqual(calls, [1, 1]);
  assert.equal(board.jobs.get(1).phase, "settled");
});

test("events build the per-worker work record and reach listeners without bulk fields", async () => {
  const seen = [];
  const { board } = boardWith(async (job, emit) => {
    emit({ kind: "bid", worker: "worker-ace", price: "700", tx: "t1" });
    emit({ kind: "patch", worker: "worker-ace", file: "src/a.js", content: "big", sha256: "s" });
    emit({ kind: "test", worker: "worker-ace", pass: true, output: "long", ms: 5 });
    emit({ kind: "error", worker: "worker-bolt", message: "declined to bid" });
    emit({ kind: "award", worker: "worker-ace", price: "700", tx: "t2" });
  });
  board.listeners.add((e) => seen.push(e));
  await board.sync([open(1)]);
  const job = board.jobs.get(1);
  assert.deepEqual(job.work["worker-ace"], {
    bid: { price: "700", tx: "t1" },
    patch: { file: "src/a.js", content: "big", sha256: "s" },
    test: { pass: true, output: "long", ms: 5 },
    error: null,
  });
  assert.deepEqual(job.work["worker-bolt"], { bid: null, patch: null, test: null, error: "declined to bid" });
  assert.equal(job.settleTx, "t2");
  assert.deepEqual(job.events.map((e) => e.kind), ["job", "bid", "patch", "test", "error", "award"]);
  assert.ok(job.events.every((e) => e.at && !("content" in e) && !("output" in e)));
  assert.deepEqual(seen.map((e) => e.jobId), [1, 1, 1, 1, 1, 1]);
  assert.deepEqual(seen[2].data, { file: "src/a.js", sha256: "s" });
  assert.deepEqual(seen[5], { kind: "award", jobId: 1, worker: "worker-ace", data: { price: "700", tx: "t2" }, at: seen[5].at });
});

test("chain fields are refreshed on every poll", async () => {
  const { board } = boardWith();
  await board.sync([open(1)]);
  await board.sync([paid(1)]);
  assert.equal(board.jobs.get(1).status.state, "Paid");
});
