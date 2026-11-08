import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { yocto } from "./near.js";

const ROOT = new URL("..", import.meta.url).pathname;
export const SHOP_REPO = join(ROOT, "shop-repo");
const JOBS = join(ROOT, "jobs");
const TEST_TIMEOUT_MS = 30_000;
export const PATCH_FILE = /^src\/[\w-]+\.js$/;

export function loadJobs() {
  return readdirSync(JOBS).sort().map((slug) => {
    const spec = JSON.parse(readFileSync(join(JOBS, slug, "job.json"), "utf8"));
    return {
      slug,
      title: spec.title,
      details: spec.details,
      file: spec.file,
      budget: yocto(spec.budget).toString(),
      test: readFileSync(join(JOBS, slug, "accept.test.js"), "utf8"),
      source: readFileSync(join(SHOP_REPO, spec.file), "utf8"),
    };
  });
}

export const readSources = () =>
  Object.fromEntries(readdirSync(join(SHOP_REPO, "src")).sort().map((f) => [`src/${f}`, readFileSync(join(SHOP_REPO, "src", f), "utf8")]));

export const sha256 = (content) => createHash("sha256").update(content).digest("hex");

export async function judge(acceptanceTest, patch) {
  const dir = mkdtempSync(join(tmpdir(), "swarmshop-"));
  const started = Date.now();
  try {
    cpSync(SHOP_REPO, dir, { recursive: true });
    writeFileSync(join(dir, patch.file), patch.content);
    writeFileSync(join(dir, "test", "accept.test.js"), acceptanceTest);
    const { NODE_TEST_CONTEXT, ...env } = process.env;
    const run = await promisify(execFile)(process.execPath, ["--test", "--test-reporter=dot"], {
      cwd: dir,
      env,
      timeout: TEST_TIMEOUT_MS,
    }).then(
      (out) => ({ pass: true, ...out }),
      (err) => ({ pass: false, stdout: err.stdout ?? "", stderr: err.stderr ?? err.message }),
    );
    return { pass: run.pass, output: `${run.stdout}${run.stderr}`.trim(), ms: Date.now() - started };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function pickWinner(passing, chainBids) {
  const ranked = new Map(chainBids.map((bid, order) => [bid.worker, { price: BigInt(bid.price), order }]));
  return passing
    .filter((r) => ranked.has(r.account))
    .map((r) => ({ ...r, ...ranked.get(r.account) }))
    .sort((a, b) => (a.price < b.price ? -1 : a.price > b.price ? 1 : a.order - b.order))[0];
}
