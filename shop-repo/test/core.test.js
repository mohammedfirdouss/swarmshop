import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify } from "../src/slugify.js";
import { truncate } from "../src/truncate.js";
import { parseDuration } from "../src/duration.js";

test("slugify keeps simple words", () => assert.equal(slugify("Hello World"), "hello-world"));
test("truncate leaves short text alone", () => assert.equal(truncate("hi", 10), "hi"));
test("parseDuration reads one unit", () => assert.equal(parseDuration("90s"), 90));
