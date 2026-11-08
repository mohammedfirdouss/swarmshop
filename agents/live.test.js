import { test } from "node:test";
import assert from "node:assert/strict";
import { yocto } from "./near.js";
import { makeWorkers } from "./workers.js";

process.env.LLM_API_KEY = "test-key";
process.env.LLM_MODEL = "test-model";

const job = { slug: "x", title: "t", details: "d", file: "src/a.js", budget: yocto("1") };

function replyWith(content) {
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content } }] });
  return makeWorkers("live")[0];
}

test("well-formed replies become a bid and a patch", async () => {
  assert.equal(await replyWith('{"price": "0.4"}').bid(job), yocto("0.4"));
  assert.equal(await replyWith('```json\n{"file": "export const a = 1;\\n"}\n```').patch(job, ""), "export const a = 1;\n");
});

for (const content of ["", "sure, 0.4 NEAR", '{"price": 0.4}', '{"price": "-1"}', '{"price": "2"}', '{"price": "0"}', "[]", '{"file": 3}']) {
  test(`malformed reply ${JSON.stringify(content)} is no bid and no patch`, async () => {
    const worker = replyWith(content);
    assert.equal(await worker.bid(job), null);
    assert.equal(await worker.patch(job, "src"), null);
  });
}

test("a missing choices field is no bid", async () => {
  globalThis.fetch = async () => Response.json({ error: "nope" });
  assert.equal(await makeWorkers("live")[1].bid(job), null);
});

test("an HTTP error throws so the shop can log it", async () => {
  globalThis.fetch = async () => new Response("rate limited", { status: 429 });
  await assert.rejects(makeWorkers("live")[2].bid(job), /LLM 429/);
});
