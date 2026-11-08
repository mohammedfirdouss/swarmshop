import { test } from "node:test";
import assert from "node:assert/strict";
import { truncate } from "../src/truncate.js";

test("fits max including the ellipsis", () => assert.equal(truncate("abcdefghij", 8), "abcde..."));
test("exact length is untouched", () => assert.equal(truncate("abcdefgh", 8), "abcdefgh"));
