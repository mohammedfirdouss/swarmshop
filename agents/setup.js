import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { actions } from "near-api-js";
import { ENV_FILE, WORKERS, WORKER_FUND, exists, loadOrCreateKey, near, provider, signer, yocto } from "./near.js";

const FAUCET = "https://helper.nearprotocol.com/account";
const WASM = new URL("../contract/target/near/swarmshop.wasm", import.meta.url).pathname;
const FOREMAN_FUND = yocto("1");

function saveEnv(key, value) {
  const lines = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8").split("\n").filter((l) => l && !l.startsWith(`${key}=`)) : [];
  writeFileSync(ENV_FILE, [...lines, `${key}=${value}`].join("\n") + "\n");
  process.env[key] = value;
}

async function fromFaucet(envKey, prefix) {
  const accountId = process.env[envKey] ?? `${prefix}-${Date.now().toString(36)}.testnet`;
  saveEnv(envKey, accountId);
  if (await exists(accountId)) return console.log(`ok      ${accountId}`), accountId;
  const key = loadOrCreateKey(accountId);
  const res = await fetch(FAUCET, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: key.getPublicKey().toString() }),
  });
  if (!res.ok) throw new Error(`faucet refused ${accountId}: ${res.status} ${await res.text()}`);
  for (let i = 0; i < 20 && !(await exists(accountId)); i++) await new Promise((r) => setTimeout(r, 1500));
  console.log(`created ${accountId} from the faucet`);
  return accountId;
}

async function subAccount(shop, name, fund) {
  const accountId = `${name}.${shop}`;
  if (await exists(accountId)) return console.log(`ok      ${accountId}`);
  const key = loadOrCreateKey(accountId);
  await signer(shop).createAccount({ newAccountId: accountId, publicKey: key.getPublicKey(), nearToTransfer: fund });
  console.log(`created ${accountId} with ${near(fund)} NEAR`);
}

async function deploy(shop) {
  const { code_hash } = await provider.viewAccount({ accountId: shop });
  if (code_hash !== "11111111111111111111111111111111") return console.log(`ok      contract on ${shop}`);
  if (!existsSync(WASM)) throw new Error(`build the contract first: cd contract && cargo near build non-reproducible-wasm`);
  await signer(shop).signAndSendTransaction({
    receiverId: shop,
    actions: [
      actions.deployContract(readFileSync(WASM)),
      actions.functionCall("new", { foreman: `foreman.${shop}` }, 30_000_000_000_000n, 0n),
    ],
  });
  console.log(`deployed contract to ${shop}, foreman is foreman.${shop}`);
}

const shop = await fromFaucet("SHOP_ACCOUNT", "swarmshop");
await fromFaucet("CUSTOMER_ACCOUNT", "swarmshop-customer");
await deploy(shop);
await subAccount(shop, "foreman", FOREMAN_FUND);
for (const w of WORKERS) await subAccount(shop, w, WORKER_FUND);
console.log(`\nshop ready: https://testnet.nearblocks.io/address/${shop}`);
