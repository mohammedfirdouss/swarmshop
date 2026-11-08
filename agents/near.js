import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Account, JsonRpcProvider, KeyPair } from "near-api-js";

export const ENV_FILE = new URL("../.env", import.meta.url).pathname;
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const RPC_URL = process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com";
const FAUCET = "https://helper.nearprotocol.com/account";
const CREDENTIALS = join(homedir(), ".near-credentials", "testnet");
export const WORKERS = ["worker-ace", "worker-bolt", "worker-cid"];
export const WORKER_FUND = 10n ** 24n;

export const provider = new JsonRpcProvider({ url: RPC_URL });
export const explorer = (hash) => `https://testnet.nearblocks.io/txns/${hash}`;
export const near = (yocto) => {
  const s = BigInt(yocto).toString().padStart(25, "0");
  return `${s.slice(0, -24)}.${s.slice(-24).replace(/0+$/, "") || "0"}`;
};
export const yocto = (nearAmount) => {
  const [whole, frac = ""] = String(nearAmount).split(".");
  return BigInt(whole + frac.padEnd(24, "0").slice(0, 24));
};

export function accounts() {
  const shop = process.env.SHOP_ACCOUNT;
  if (!shop) throw new Error("no SHOP_ACCOUNT in .env, run `npm run setup` first");
  return {
    shop,
    customer: process.env.CUSTOMER_ACCOUNT,
    foreman: `foreman.${shop}`,
    workers: Object.fromEntries(WORKERS.map((w) => [w, `${w}.${shop}`])),
  };
}

const credentialPath = (accountId) => join(CREDENTIALS, `${accountId}.json`);

const envKeys = () => JSON.parse(process.env.NEAR_KEYS ?? "{}");

export function loadOrCreateKey(accountId) {
  if (envKeys()[accountId]) return KeyPair.fromString(envKeys()[accountId]);
  const path = credentialPath(accountId);
  if (existsSync(path)) return KeyPair.fromString(JSON.parse(readFileSync(path, "utf8")).private_key);
  const key = KeyPair.fromRandom("ed25519");
  mkdirSync(CREDENTIALS, { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({ account_id: accountId, public_key: key.getPublicKey().toString(), private_key: key.toString() }),
    { mode: 0o600 },
  );
  return key;
}

export function signer(accountId) {
  if (!envKeys()[accountId] && !existsSync(credentialPath(accountId))) throw new Error(`no key for ${accountId} in NEAR_KEYS or ${CREDENTIALS}`);
  return new Account(accountId, provider, loadOrCreateKey(accountId).toString());
}

export async function faucetAccount(accountId, publicKey) {
  const res = await fetch(FAUCET, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: publicKey.toString() }),
  });
  if (!res.ok) throw new Error(`faucet refused ${accountId}: ${res.status} ${await res.text()}`);
  for (let i = 0; i < 20 && !(await exists(accountId)); i++) await new Promise((r) => setTimeout(r, 1500));
}

export async function exists(accountId) {
  try {
    await provider.viewAccount({ accountId });
    return true;
  } catch {
    return false;
  }
}

export const balance = async (accountId) => BigInt((await provider.viewAccount({ accountId })).amount);

export const view = (contractId, method, args = {}) => provider.callFunction({ contractId, method, args });

export async function listAllJobs(shop) {
  const jobs = [];
  for (let from = 0; ; from += 100) {
    const page = await view(shop, "list_jobs", { from, limit: 100 });
    jobs.push(...page);
    if (page.length < 100) return jobs;
  }
}

export async function call(accountId, contractId, methodName, args, deposit = 0n) {
  const res = await signer(accountId).callFunctionRaw({ contractId, methodName, args, deposit });
  const value = res.status.SuccessValue;
  return {
    hash: res.transaction.hash,
    value: value ? JSON.parse(Buffer.from(value, "base64").toString() || "null") : null,
  };
}
