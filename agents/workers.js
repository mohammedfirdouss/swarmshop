import { existsSync, readFileSync } from "node:fs";
import { WORKERS, near, yocto } from "./near.js";

const PERSONAS = {
  "worker-ace": {
    simBidPercent: 70,
    style: "You are Ace, a careful senior engineer. You charge a fair price and only ship fixes you are sure of.",
  },
  "worker-bolt": {
    simBidPercent: 30,
    style: "You are Bolt, a fast and cheap freelancer. You bid low to win and write the quickest fix you can.",
  },
  "worker-cid": {
    simBidPercent: 50,
    style: "You are Cid, a steady mid-level engineer. You bid in the middle and fix the bug that was reported.",
  },
};

function simWorker(name) {
  const { simBidPercent } = PERSONAS[name];
  return {
    name,
    bid: async (job) => (job.budget * BigInt(simBidPercent)) / 100n,
    patch: async (job) => {
      const fixture = new URL(`./sim/${job.slug}/${name}.js`, import.meta.url);
      return existsSync(fixture) ? readFileSync(fixture, "utf8") : null;
    },
  };
}

const describe = (job) =>
  `Job: ${job.title}\nDetails: ${job.details}\nFile: ${job.file}\nBudget: ${near(job.budget)} NEAR`;

function parseJson(text) {
  const body = text.trim().replace(/^```(?:json)?\n([\s\S]*)\n```$/, "$1");
  try {
    const value = JSON.parse(body);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function parseBid(text, budget) {
  const price = parseJson(text)?.price;
  if (typeof price !== "string" || !/^\d+(\.\d{1,24})?$/.test(price)) return null;
  const amount = yocto(price);
  return amount > 0n && amount <= budget ? amount : null;
}

function parsePatch(text) {
  const file = parseJson(text)?.file;
  return typeof file === "string" && file.trim() ? file : null;
}

function liveWorker(name) {
  const { style } = PERSONAS[name];
  const baseUrl = process.env.LLM_BASE_URL ?? "https://cloud-api.near.ai/v1";
  const ask = async (prompt) => {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.LLM_API_KEY}` },
      body: JSON.stringify({
        model: process.env.LLM_MODEL,
        messages: [
          { role: "system", content: `${style} Reply with one JSON object and nothing else.` },
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
    patch: async (job, source) =>
      parsePatch(
        await ask(
          `${describe(job)}\n\nCurrent ${job.file}:\n${source}\n\nFix the bug. Reply as {"file": "<the entire new content of ${job.file}>"}.`,
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
