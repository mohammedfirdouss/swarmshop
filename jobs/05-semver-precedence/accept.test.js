import { test } from "node:test";
import assert from "node:assert/strict";
import { compareVersions } from "../src/version.js";

test("numeric parts compare as numbers", () => {
  assert.equal(compareVersions("1.10.0", "1.9.0"), 1);
  assert.equal(compareVersions("1.2.0", "1.2.10"), -1);
  assert.equal(compareVersions("2.0.0", "2.0.0"), 0);
});

test("pre-releases follow semver precedence", () => {
  const order = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0"];
  for (let i = 1; i < order.length; i++) assert.equal(compareVersions(order[i - 1], order[i]), -1, `${order[i - 1]} < ${order[i]}`);
});

test("build metadata is ignored", () => assert.equal(compareVersions("1.0.0+build.7", "1.0.0"), 0));
