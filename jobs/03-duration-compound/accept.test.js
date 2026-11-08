import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDuration } from "../src/duration.js";

test("adds up compound units", () => {
  assert.equal(parseDuration("1h30m"), 5400);
  assert.equal(parseDuration("2m5s"), 125);
});
test("still rejects garbage", () => {
  assert.throws(() => parseDuration("abc"));
  assert.throws(() => parseDuration(""));
});
