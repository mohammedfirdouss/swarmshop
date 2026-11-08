import { existsSync, readFileSync } from "node:fs";
import { PATCH_FILE, loadJobs, readSources } from "./jobs.js";
import { WORKERS, near, yocto } from "./near.js";

export const PERSONAS = {
  "worker-ace": {
    handle: "Ace",
    persona: "Careful senior engineer. Fair price, only ships fixes it is sure of.",
    simBidPercent: 70,
    maxTokens: 4000,
  },
  "worker-bolt": {
    handle: "Bolt",
    persona: "Fast, cheap freelancer. Bids low to win and writes the quickest fix possible.",
    simBidPercent: 30,
    maxTokens: 600,
  },
  "worker-cid": {
    handle: "Cid",
    persona: "Steady mid-level engineer. Bids in the middle and fixes exactly the bug reported.",
    simBidPercent: 50,
    maxTokens: 2000,
  },
};

const NOOP_PATCH = { file: "src/noop.js", content: "export {};\n" };

function simWorker(name) {
  const { simBidPercent } = PERSONAS[name];
  return {
    name,
    bid: async (job) => (BigInt(job.budget) * BigInt(simBidPercent)) / 100n,
    patch: async (job) => {
      const example = loadJobs().find((e) => e.title === job.title);
      const fixture = example && new URL(`./sim/${example.slug}/${name}.js`, import.meta.url);
      return fixture && existsSync(fixture) ? { file: example.file, content: readFileSync(fixture, "utf8") } : NOOP_PATCH;
    },
  };
}

function describe(job) {
  const sources = Object.entries(readSources())
    .map(([file, content]) => `--- ${file}\n${content}`)
    .join("\n");
  return `Job: ${job.title}\nDetails: ${job.details}\nBudget: ${near(job.budget)} NEAR\n\nAcceptance test (test/accept.test.js), the fix must make it pass:\n${job.acceptance_test}\n\nRepository files:\n${sources}`;
}

function parseJson(text) {
  const body = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try {
    const value = JSON.parse(body);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export function parseBid(text, budget) {
  const price = parseJson(text)?.price;
  if (typeof price !== "string" || !/^\d+(\.\d{1,24})?$/.test(price)) return null;
  const amount = yocto(price);
  return amount > 0n && amount <= BigInt(budget) ? amount : null;
}

export function parsePatch(text) {
  const reply = parseJson(text);
  const ok = typeof reply?.file === "string" && PATCH_FILE.test(reply.file) && typeof reply.content === "string" && reply.content.trim();
  return ok ? { file: reply.file, content: reply.content } : null;
}

function liveWorker(name) {
  const { handle, persona, maxTokens } = PERSONAS[name];
  const baseUrl = process.env.LLM_BASE_URL ?? "https://cloud-api.near.ai/v1";
  const model = process.env[`LLM_MODEL_${handle.toUpperCase()}`] ?? process.env.LLM_MODEL;
  const ask = async (prompt) => {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.LLM_API_KEY}` },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: `You are ${handle}, a freelance programmer. ${persona} Reply with one JSON object and nothing else.` },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return String(data.choices?.[0]?.message?.content ?? "");
  };
  return {
    name,
    bid: async (job) =>
      parseBid(
        await ask(`${describe(job)}\n\nHow much do you charge to fix this? Reply as {"price": "<NEAR, decimal string, at most the budget>"}.`),
        job.budget,
      ),
    patch: async (job) =>
      parsePatch(
        await ask(
          `${describe(job)}\n\nFix the bug by rewriting one file under src/. Reply as {"file": "src/<name>.js", "content": "<the entire new content of that file>"}.`,
        ),
      ),
  };
}

const MODES = { sim: simWorker, live: liveWorker };

export function makeWorkers(mode) {
  const make = MODES[mode];
  if (!make) throw new Error(`unknown mode "${mode}", use one of: ${Object.keys(MODES).join(", ")}`);
  if (mode === "live" && (!process.env.LLM_API_KEY || !process.env.LLM_MODEL)) {
    throw new Error("live mode needs LLM_API_KEY and LLM_MODEL (LLM_BASE_URL is optional)");
  }
  return WORKERS.map(make);
}
