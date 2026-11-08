import { test } from "node:test";
import assert from "node:assert/strict";
import { judge, loadJobs } from "./jobs.js";
import { yocto } from "./near.js";
import { makeWorkers } from "./workers.js";

process.env.LLM_API_KEY = "test-key";
process.env.LLM_MODEL = "test-model";

const job = { id: 7, title: "t", details: "d", acceptance_test: "test('x', () => {})", budget: yocto("1").toString(), bids: [] };

function replyWith(content) {
  const prompts = [];
  globalThis.fetch = async (_url, { body }) => {
    prompts.push(JSON.parse(body).messages.at(-1).content);
    return Response.json({ choices: [{ message: { content } }] });
  };
  return { worker: makeWorkers("live")[0], prompts };
}

test("well-formed replies become a bid and a patch", async () => {
  assert.equal(await replyWith('{"price": "0.4"}').worker.bid(job), yocto("0.4"));
  const patch = await replyWith('```json\n{"file": "src/slugify.js", "content": "export const a = 1;\\n"}\n```').worker.patch(job);
  assert.deepEqual(patch, { file: "src/slugify.js", content: "export const a = 1;\n" });
  const chatty = await replyWith('Here is the fix:\n{"file": "src/slugify.js", "content": "export const a = 2;\\n"}\n```\nDone.').worker.patch(job);
  assert.deepEqual(chatty, { file: "src/slugify.js", content: "export const a = 2;\n" });
});

test("the worker sees the acceptance test and every source file", async () => {
  const { worker, prompts } = replyWith('{"price": "0.4"}');
  await worker.patch(job);
  assert.match(prompts[0], /test\('x', \(\) => \{\}\)/);
  for (const file of ["src/slugify.js", "src/truncate.js", "src/duration.js", "src/money.js"]) assert.match(prompts[0], new RegExp(file));
});

for (const content of ["", "sure, 0.4 NEAR", '{"price": 0.4}', '{"price": "-1"}', '{"price": "2"}', '{"price": "0"}', "[]", '{"file": 3}']) {
  test(`malformed reply ${JSON.stringify(content)} is no bid and no patch`, async () => {
    const { worker } = replyWith(content);
    assert.equal(await worker.bid(job), null);
    assert.equal(await worker.patch(job), null);
  });
}

for (const content of [
  '{"file": "src/slugify.js"}',
  '{"file": "src/slugify.js", "content": "  "}',
  '{"file": "../package.json", "content": "{}"}',
  '{"file": "test/accept.test.js", "content": "x"}',
  '{"file": "src/a/b.js", "content": "x"}',
]) {
  test(`patch reply ${content} is rejected`, async () => {
    assert.equal(await replyWith(content).worker.patch(job), null);
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

test("sim workers patch known titles from fixtures and fail unknown ones", async () => {
  const [ace] = makeWorkers("sim");
  const example = loadJobs()[0];
  const known = await ace.patch({ ...job, title: example.title });
  assert.equal(known.file, example.file);
  assert.equal((await judge(example.test, known)).pass, true);
  const unknown = await ace.patch({ ...job, title: "a bug nobody scripted", acceptance_test: example.test });
  assert.equal((await judge(example.test, unknown)).pass, false);
});
