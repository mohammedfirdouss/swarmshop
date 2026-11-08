import { test } from "node:test";
import assert from "node:assert/strict";
import { pickWinner } from "./jobs.js";

const bid = (worker, price) => ({ worker, price: String(price) });
const passing = (...accounts) => accounts.map((account) => ({ account }));

test("cheapest passing bid wins", () => {
  const w = pickWinner(passing("ace", "cid"), [bid("ace", 7), bid("bolt", 3), bid("cid", 5)]);
  assert.equal(w.account, "cid");
  assert.equal(w.price, 5n);
});

test("a tie goes to the bid that reached the chain first", () => {
  assert.equal(pickWinner(passing("ace", "bolt"), [bid("bolt", 5), bid("ace", 5)]).account, "bolt");
  assert.equal(pickWinner(passing("bolt", "ace"), [bid("ace", 5), bid("bolt", 5)]).account, "ace");
});

test("the price comes from the chain, not from the worker", () => {
  const w = pickWinner([{ account: "ace", price: 1n }], [bid("ace", 9)]);
  assert.equal(w.price, 9n);
});

test("a passing patch with no bid on chain cannot win", () => {
  assert.equal(pickWinner(passing("ace"), [bid("bolt", 1)]), undefined);
});
