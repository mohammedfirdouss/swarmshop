import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { yocto } from "./near.js";

const ROOT = new URL("..", import.meta.url).pathname;
export const SHOP_REPO = join(ROOT, "shop-repo");
const JOBS = join(ROOT, "jobs");
const TEST_TIMEOUT_MS = 30_000;

export function loadJobs() {
  return readdirSync(JOBS).sort().map((slug) => {
    const spec = JSON.parse(readFileSync(join(JOBS, slug, "job.json"), "utf8"));
    return {
      slug,
      title: spec.title,
      details: spec.details,
      file: spec.file,
      budget: yocto(spec.budget),
      source: readFileSync(join(SHOP_REPO, spec.file), "utf8"),
      acceptTest: join(JOBS, slug, "accept.test.js"),
    };
  });
}

export const sha256 = (content) => createHash("sha256").update(content).digest("hex");

export function judge(job, content) {
  const dir = mkdtempSync(join(tmpdir(), `swarmshop-${job.slug}-`));
  try {
    cpSync(SHOP_REPO, dir, { recursive: true });
    writeFileSync(join(dir, job.file), content);
    cpSync(job.acceptTest, join(dir, "test", "accept.test.js"));
    const run = spawnSync(process.execPath, ["--test", "--test-reporter=dot"], {
      cwd: dir,
      encoding: "utf8",
      timeout: TEST_TIMEOUT_MS,
    });
    return { pass: run.status === 0, output: `${run.stdout}${run.stderr}`.trim() };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
