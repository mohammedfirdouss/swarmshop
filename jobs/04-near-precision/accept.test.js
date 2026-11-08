import { test } from "node:test";
import assert from "node:assert/strict";
import { formatNear } from "../src/money.js";

test("never rounds up", () => assert.equal(formatNear("999999999999999999999999"), "0.99 NEAR"));
test("keeps big amounts exact", () => assert.equal(formatNear("123456789012345678901234567890"), "123456.78 NEAR"));
test("whole amounts", () => assert.equal(formatNear("2000000000000000000000000"), "2.00 NEAR"));
