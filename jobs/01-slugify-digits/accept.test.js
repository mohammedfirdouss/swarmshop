import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify } from "../src/slugify.js";

test("keeps digits", () => assert.equal(slugify("Top 10 Tips"), "top-10-tips"));
test("still joins words", () => assert.equal(slugify("  Hello,  World! "), "hello-world"));
