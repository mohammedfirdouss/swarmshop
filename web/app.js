const EXPLORER = "https://testnet.nearblocks.io";
const NEAR_API = "https://esm.sh/near-api-js@7.3.1";
const DEFAULT_RPC = "https://test.rpc.fastnear.com";
const STORE_KEY = "swarmshop.account";
const POSTS_KEY = "swarmshop.posts";
const YOCTO = 10n ** 24n;
const GAS = 30_000_000_000_000n;
const POLL_MS = 5000;
const WORKER_HUES = ["var(--accent)", "#7fa6ff", "#4fc98a"];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const near = (y) => {
  const s = BigInt(y).toString().padStart(25, "0");
  return `${s.slice(0, -24)}.${s.slice(-24, -22)}`;
};
const yocto = (amount) => {
  const [whole, frac = ""] = String(amount).trim().split(".");
  return BigInt((whole || "0") + frac.padEnd(24, "0").slice(0, 24));
};
const txLink = (hash, label = "view transaction") =>
  hash ? `<a class="tx" href="${EXPLORER}/txns/${encodeURIComponent(hash)}" target="_blank" rel="noopener">${esc(label)} ↗</a>` : "";
const acctLink = (id) => `<a class="mono" href="${EXPLORER}/address/${encodeURIComponent(id)}" target="_blank" rel="noopener">${esc(id)}</a>`;
const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
const timeLeft = (ns) => {
  const m = Math.round((Number(BigInt(ns) / 1_000_000n) - Date.now()) / 60000);
  if (m <= 0) return "deadline passed";
  return m < 60 ? `${m} min left` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60} min left` : `${Math.floor(m / 1440)} d left`;
};
const avatar = (w, size) =>
  `<svg class="avatar" viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true"><path d="M16 2 L28 9 L28 23 L16 30 L4 23 L4 9 Z" fill="${w.hue}"/><text x="16" y="21" text-anchor="middle" fill="#16181d">${esc(w.handle[0] ?? "?")}</text></svg>`;
const CHECK = `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5 L5 9.5 L10 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CROSS = `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3 L9 9 M9 3 L3 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

function indexWorkers(list) {
  const workers = list.map((w, idx) => ({ ...w, hue: WORKER_HUES[idx % WORKER_HUES.length] }));
  const byAccount = new Map(workers.map((w) => [w.account, w]));
  const byName = new Map(workers.map((w) => [w.name, w]));
  const lookup = (ref) =>
    byAccount.get(ref) ?? byName.get(ref) ?? { name: ref.split(".")[0], account: ref, handle: ref.split(".")[0].replace(/^worker-/, ""), hue: "var(--line-strong)" };
  return { list: workers, lookup };
}

function jobRows(job, swarm) {
  const handled = Object.keys(job.work ?? {}).length > 0;
  const bidders = new Set(job.bids.map((b) => b.worker));
  const refs = [...swarm.list.map((w) => w.account), ...[...bidders].filter((a) => !swarm.list.some((w) => w.account === a))];
  return refs.map((account) => {
    const w = swarm.lookup(account);
    const work = job.work?.[w.name] ?? {};
    const chainBid = job.bids.find((b) => b.worker === account);
    return {
      w,
      bid: work.bid ?? (chainBid ? { price: chainBid.price, tx: null } : null),
      patch: work.patch ?? null,
      test: work.test ?? null,
      error: work.error ?? null,
      winner: job.status.state === "Paid" && job.status.worker === account,
      handled,
    };
  });
}

function jobPhase(job, rows) {
  if (job.status.state !== "Open") return job.status.state;
  if (rows.some((r) => r.test)) return "Testing";
  if (rows.some((r) => r.bid)) return "Bidding";
  return "Posted";
}
const PHASE_CHIP = { Posted: "chip-wait", Bidding: "chip-wait", Testing: "chip-wait", Paid: "chip-good", Refunded: "chip-bad" };

function workerActivity(w, jobs) {
  for (const job of jobs) {
    if (job.status.state !== "Open" || job.phase === "settled" || !Object.keys(job.work ?? {}).length) continue;
    const work = job.work[w.name] ?? {};
    if (work.test) return { busy: true, label: `Tests ${work.test.pass ? "passed" : "failed"} on #${job.id}. Waiting for the verdict.` };
    if (work.patch) return { busy: true, label: `Patch in on #${job.id}. Under test.` };
    if (work.bid) return { busy: true, label: `Bid placed on #${job.id}. Writing the fix.` };
    return { busy: true, label: `Reading job #${job.id}.` };
  }
  return { busy: false, label: "Idle. Watching the chain for the next job." };
}

function lineDiff(a, b) {
  const A = a.split("\n"), B = b.split("\n");
  if (A.length * B.length > 250_000) return B.map((s) => ({ t: "ctx", s }));
  const dp = Array.from({ length: A.length + 1 }, () => new Uint16Array(B.length + 1));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) out.push({ t: "ctx", s: A[i++] }), j++;
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: "del", s: A[i++] });
    else out.push({ t: "add", s: B[j++] });
  }
  while (i < A.length) out.push({ t: "del", s: A[i++] });
  while (j < B.length) out.push({ t: "add", s: B[j++] });
  return out;
}
const SIGN = { ctx: " ", add: "+", del: "-" };
const renderDiff = (ops) => `<div class="diff">${ops.map((o) => `<div class="${o.t}">${SIGN[o.t]} ${esc(o.s)}</div>`).join("")}</div>`;

function renderStats(stats) {
  const items = [
    [stats.jobs_posted, "jobs posted"], [stats.jobs_paid, "paid"], [stats.jobs_refunded, "refunded"],
    [`${near(stats.paid_to_workers)} Ⓝ`, "paid to agents"], [`${near(stats.margin)} Ⓝ`, "shop margin"],
  ];
  return items.map(([v, k]) => `<div class="stat"><b>${esc(v)}</b><span>${k}</span></div>`).join("");
}

function renderWorkers(swarm, jobs) {
  return swarm.list.map((w) => {
    const act = workerActivity(w, jobs);
    return `<article class="worker${act.busy ? " busy" : ""}" data-worker="${esc(w.name)}">
      ${avatar(w, 44)}
      <div class="name"><h3>${esc(w.handle)}</h3>${acctLink(w.account)}</div>
      <div class="persona">${esc(w.persona)}</div>
      <div class="status"><span class="dot"></span><span>${esc(act.label)}</span></div>
      <div class="tally"><span><b>${esc(w.bids)}</b> bids</span><span><b>${esc(w.wins)}</b> wins</span><span><b>${near(w.earned)} Ⓝ</b> earned</span></div>
    </article>`;
  }).join("");
}

function step(state, title, when, body) {
  const pin = state === "done" ? CHECK : state === "fail" ? CROSS : "";
  return `<li class="step ${state}"><span class="pin">${pin}</span><div class="head"><h4>${title}</h4><span class="when">${esc(when)}</span></div><div class="body">${body}</div></li>`;
}
const details = (key, summary, inner) => `<details data-k="${esc(key)}"><summary><span>${esc(summary)}</span></summary>${inner}</details>`;
const line = (w, what, price) => `<div class="line">${avatar(w, 20)}<span class="what">${what}</span>${price ?? ""}</div>`;

function renderJob(job, swarm, examples) {
  const rows = jobRows(job, swarm);
  const phase = jobPhase(job, rows);
  const open = job.status.state === "Open";
  const final = !open;
  const handled = rows[0]?.handled;
  const ev = (kind, worker) => job.events?.find((e) => e.kind === kind && (!worker || e.worker === worker));
  const bidsDone = rows.filter((r) => r.bid).length;

  const bidLines = rows.map((r) => {
    if (r.bid) return line(r.w, `<b>${esc(r.w.handle)}</b> bid ${txLink(r.bid.tx, "on-chain")}`, `<span class="price${r.winner ? " win" : ""}">${near(r.bid.price)} Ⓝ${r.winner ? " · winner" : ""}</span>`);
    return line(r.w, `<span class="quiet">${final ? `${esc(r.w.handle)} did not bid` : `Waiting for ${esc(r.w.handle)}’s bid`}</span>`);
  });
  const bidState = final || bidsDone === rows.length ? "done" : "live";
  const bidWhen = clock(ev("bid")?.at);

  const testLines = rows.map((r) => {
    if (r.test) {
      const chip = `<span class="chip ${r.test.pass ? "chip-good" : "chip-bad"}">${r.test.pass ? "pass" : "fail"}</span>`;
      const out = r.test.output ? details(`${job.id}:test:${r.w.name}`, `Test output · ${r.test.ms} ms`, `<pre>${esc(r.test.output)}</pre>`) : "";
      return `${line(r.w, `<b>${esc(r.w.handle)}</b> ${r.patch ? `patched <code>${esc(r.patch.file)}</code>` : "submitted a patch"}`, chip)}${out}`;
    }
    if (r.error) return line(r.w, `<b>${esc(r.w.handle)}</b> <span class="quiet">dropped out: ${esc(r.error)}</span>`, `<span class="chip chip-bad">error</span>`);
    if (!r.bid && final) return line(r.w, `<span class="quiet">${esc(r.w.handle)} did not take part</span>`);
    if (r.patch) return line(r.w, `<b>${esc(r.w.handle)}</b> <span class="quiet">patch submitted, running the acceptance test</span>`, `<span class="chip chip-wait">testing</span>`);
    if (r.bid) return line(r.w, `<b>${esc(r.w.handle)}</b> <span class="quiet">writing the fix</span>`, `<span class="chip chip-wait">working</span>`);
    return line(r.w, `<span class="quiet">${esc(r.w.handle)} has not started</span>`);
  });
  const testsSettled = rows.every((r) => r.test || r.error || (!r.bid && final));
  const testState = !handled ? "idle" : final || testsSettled ? (rows.some((r) => r.test?.pass) ? "done" : final ? "fail" : "done") : "live";
  const testBody = handled
    ? `<div class="lines">${testLines.join("")}</div>`
    : `<p>This job was judged by another shop process. Only the on-chain outcome is available here.</p>`;
  const testWhen = clock(ev("test")?.at);

  let settle;
  if (job.status.state === "Paid") {
    const win = rows.find((r) => r.winner);
    const margin = BigInt(job.budget) - BigInt(job.status.price);
    const example = examples.find((e) => e.title === job.title);
    const patch = win?.patch
      ? details(`${job.id}:patch`, `${win.w.handle}’s patch to ${win.patch.file}${example?.source ? " (diff against the original)" : ""}`,
          renderDiff(example?.source ? lineDiff(example.source, win.patch.content) : win.patch.content.split("\n").map((s) => ({ t: "ctx", s }))))
      : "";
    settle = step("done", "Paid", clock(ev("award")?.at),
      `<div class="settle paid"><div class="amount">${near(job.status.price)} Ⓝ<small>paid to ${esc(win?.w.handle ?? job.status.worker)}</small></div>
       <div class="meta"><span>shop margin <b>${near(margin)} Ⓝ</b></span><span>patch sha256 <code title="${esc(job.status.patch_sha256)}">${esc(String(job.status.patch_sha256).slice(0, 12))}…</code></span>${txLink(job.settleTx ?? ev("award")?.tx, "award transaction")}</div></div>${patch}`);
  } else if (job.status.state === "Refunded") {
    settle = step("fail", "Refunded", clock(ev("refund")?.at),
      `<div class="settle refunded"><div class="amount">${near(job.budget)} Ⓝ<small>returned to the customer</small></div>
       <div class="meta"><span>No patch passed the acceptance test, so the shop earned nothing.</span>${txLink(job.settleTx ?? ev("refund")?.tx, "refund transaction")}</div></div>`);
  } else {
    settle = step("idle", "Verdict", "", `<p>The contract pays the cheapest passing fix and keeps the rest as margin, or refunds the full budget.</p>`);
  }

  return `<article class="job" id="job-${job.id}" data-state="${esc(job.status.state)}">
    <div class="job-head">
      <h3><span class="num">#${job.id}</span>${esc(job.title)}</h3>
      <span class="chip ${PHASE_CHIP[phase]}">${phase}</span>
      <div class="facts"><span>budget <b>${near(job.budget)} Ⓝ</b></span><span>customer ${acctLink(job.customer)}</span><span>${open ? esc(timeLeft(job.deadline_ns)) : "closed"}</span></div>
    </div>
    <ol class="timeline">
      ${step("done", "Posted", clock(ev("job")?.at),
        `<p><b>${near(job.budget)} Ⓝ</b> locked in escrow. ${txLink(job.postTx ?? ev("job")?.tx ?? postStore.get()?.[job.id], "post transaction")}</p>
         <p>${esc(job.details)}</p>
         ${job.acceptance_test ? details(`${job.id}:accept`, "Acceptance test", `<pre>${esc(job.acceptance_test)}</pre>`) : ""}`)}
      ${step(bidState, `Bids <span class="muted">${bidsDone} of ${rows.length}</span>`, bidWhen, `<div class="lines">${bidLines.join("")}</div>`)}
      ${step(testState, "Tests", testWhen, testBody)}
      ${settle}
    </ol>
  </article>`;
}

const ui = { stats: "", workers: "", jobs: "" };
function swap(id, html, key) {
  if (ui[key] === html) return;
  const el = $(id);
  const wasOpen = new Set([...el.querySelectorAll("details[open]")].map((d) => d.dataset.k));
  el.innerHTML = html;
  for (const d of el.querySelectorAll("details")) if (wasOpen.has(d.dataset.k)) d.open = true;
  ui[key] = html;
}

let state = null;
let examples = [];
function render() {
  if (!state) return;
  const swarm = indexWorkers(state.workers);
  const jobs = [...state.jobs].sort((a, b) => b.id - a.id);
  swap("stats", renderStats(state.stats), "stats");
  swap("workers", renderWorkers(swarm, jobs), "workers");
  swap("jobs", jobs.length ? jobs.map((j) => renderJob(j, swarm, examples)).join("") : `<div class="empty">No jobs yet. Post the first one above.</div>`, "jobs");
  $("network").textContent = state.network;
  $("mode").textContent = state.mode === "live" ? "live LLM agents" : "scripted agents";
  const shop = $("shop-link");
  shop.textContent = state.shop;
  shop.href = `${EXPLORER}/address/${encodeURIComponent(state.shop)}`;
  $("updated").textContent = `updated ${new Date().toLocaleTimeString()}`;
}

let inFlight = false;
async function refresh() {
  if (inFlight) return;
  inFlight = true;
  try {
    const res = await fetch("/api/state", { cache: "no-store" });
    if (!res.ok) throw new Error(`state ${res.status}`);
    state = await res.json();
    render();
    refreshBalance();
  } catch (e) {
    $("updated").textContent = `offline: ${e.message}`;
  } finally {
    inFlight = false;
  }
}

const stored = (key) => ({
  get() { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set(v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} },
});
const accountStore = stored(STORE_KEY);
const postStore = stored(POSTS_KEY);
let account = accountStore.get();
let balance = null;
let accountError = "";
const rpcUrl = () => new URL(state?.rpc ?? DEFAULT_RPC, location.href).href;

async function viewBalance(accountId) {
  const res = await fetch(rpcUrl(), { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "b", method: "query", params: { request_type: "view_account", finality: "final", account_id: accountId } }) });
  const body = await res.json();
  if (body.error) throw new Error(body.error.cause?.name ?? body.error.message ?? "RPC error");
  return body.result.amount;
}

async function refreshBalance() {
  if (!account || !state) return;
  try { balance = await viewBalance(account.accountId); } catch { balance = null; }
  renderAccount();
}

function renderAccount() {
  const bal = balance === null ? "…" : `${near(balance)} Ⓝ`;
  const typed = { id: $("acct-id")?.value ?? "", key: $("acct-key")?.value ?? "" };
  $("account").innerHTML = account
    ? `<div class="who"><b>${bal}</b>${acctLink(account.accountId)}</div>`
    : `<button id="get-account-top" class="btn btn-small" type="button">Get a free testnet account</button>`;
  $("get-account-top")?.addEventListener("click", getAccount);
  $("payer").innerHTML = account
    ? `<div class="lead"><span>Paying from <b class="mono">${esc(account.accountId)}</b> · ${bal}</span><button id="forget-account" class="linkish" type="button">change account</button></div>`
    : `<div class="lead"><span>You need a testnet account to pay for the job.</span><button id="get-account" class="btn btn-small" type="button">Get a free testnet account</button></div>
       ${accountError ? `<div class="err">${esc(accountError)}</div>` : ""}
       <details class="alt"${accountError ? " open" : ""}><summary><span>Use an existing testnet account</span></summary>
         <div class="fields">
           <input id="acct-id" value="${esc(typed.id)}" placeholder="you.testnet" autocomplete="off" spellcheck="false" aria-label="Account id">
           <input id="acct-key" value="${esc(typed.key)}" placeholder="ed25519:…" autocomplete="off" spellcheck="false" aria-label="Private key">
           <button id="use-account" class="btn btn-small" type="button">Use this account</button>
         </div></details>`;
  $("get-account")?.addEventListener("click", getAccount);
  $("use-account")?.addEventListener("click", useAccount);
  $("forget-account")?.addEventListener("click", () => { account = null; balance = null; accountStore.set(null); renderAccount(); });
}

function adopt(next) {
  account = next;
  accountError = "";
  balance = null;
  accountStore.set(account);
  renderAccount();
  refreshBalance();
}

async function getAccount(ev) {
  const btn = ev.currentTarget;
  btn.disabled = true;
  btn.textContent = "Creating your account…";
  try {
    const res = await fetch("/api/accounts", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.accountId) throw new Error(body.error ?? `accounts ${res.status}`);
    adopt({ accountId: body.accountId, privateKey: body.privateKey });
    note("Your testnet account is ready and funded by the faucet. Post a job.", "good");
  } catch (e) {
    accountError = `Could not create an account: ${e.message}`;
    renderAccount();
  }
}

async function useAccount() {
  const accountId = $("acct-id").value.trim(), privateKey = $("acct-key").value.trim();
  if (!accountId || !/^ed25519:[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(privateKey)) {
    accountError = "Enter the account id and its ed25519 private key (the long string starting with ed25519:).";
    return renderAccount();
  }
  try {
    await viewBalance(accountId);
  } catch (e) {
    accountError = `Could not find ${accountId} on testnet: ${e.message}`;
    return renderAccount();
  }
  adopt({ accountId, privateKey });
}

function note(text, kind = "") {
  const el = $("post-note");
  el.className = `note ${kind}`;
  el.innerHTML = text;
}

async function loadExamples() {
  try {
    const res = await fetch("/api/examples");
    examples = await res.json();
  } catch { examples = []; }
  const sel = $("example");
  for (const e of examples) {
    const opt = document.createElement("option");
    opt.value = e.slug;
    opt.textContent = `${e.title} · ${near(e.budget)} Ⓝ`;
    sel.append(opt);
  }
  sel.onchange = () => {
    const e = examples.find((x) => x.slug === sel.value);
    if (!e) return;
    $("title").value = e.title;
    $("details").value = e.details;
    $("test").value = e.test;
    $("budget").value = near(e.budget);
    updateLock();
  };
}

function updateLock() {
  const n = Number($("budget").value);
  $("lock-amount").textContent = Number.isFinite(n) && n > 0 ? n.toFixed(2) : "0.00";
}

async function postJob(ev) {
  ev.preventDefault();
  const form = ev.currentTarget;
  const title = $("title").value.trim(), detailsText = $("details").value.trim(), test = $("test").value;
  const budget = $("budget").value, minutes = Number($("minutes").value);
  if (!title || !detailsText || !test.trim()) return note("Fill in the title, what is wrong, and the acceptance test.", "bad");
  if (!(Number(budget) >= 0.1)) return note("The budget must be at least 0.1 NEAR.", "bad");
  if (!state?.shop) return note("Still connecting to the shop. Try again in a moment.", "bad");
  if (!account) return note("Get a free testnet account first (top right). It pays for the job.", "bad");
  const btn = $("submit");
  btn.disabled = true;
  note(`Signing <code>post_job</code> with ${esc(account.accountId)} and locking ${esc(near(yocto(budget)))} Ⓝ…`);
  try {
    const { Account, JsonRpcProvider } = await import(NEAR_API);
    const signer = new Account(account.accountId, new JsonRpcProvider({ url: rpcUrl() }), account.privateKey);
    const res = await signer.callFunctionRaw({
      contractId: state.shop, methodName: "post_job",
      args: { title, details: detailsText, acceptance_test: test, minutes },
      deposit: yocto(budget), gas: GAS,
    });
    const hash = res.transaction.hash;
    const id = JSON.parse(atob(res.status.SuccessValue));
    postStore.set({ ...(postStore.get() ?? {}), [id]: hash });
    note(`Posted job #${esc(id)}. ${txLink(hash, "post transaction")}`, "good");
    form.reset();
    updateLock();
    await showJob(id);
  } catch (e) {
    note(`Posting failed: ${esc(e.message.split("\n")[0])}`, "bad");
  } finally {
    btn.disabled = false;
  }
}

async function showJob(id) {
  for (let i = 0; i < 12; i++) {
    await refresh();
    const el = $(`job-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.classList.add("flash");
      return;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

$("post").addEventListener("submit", postJob);
$("budget").addEventListener("input", updateLock);
renderAccount();
loadExamples().then(refresh);
setInterval(refresh, POLL_MS);
try {
  const es = new EventSource("/api/events");
  es.onmessage = () => refresh();
} catch {}
