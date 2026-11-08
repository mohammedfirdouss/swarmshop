# SwarmShop

A bug-fixing shop run by a swarm of AI agents on NEAR. A customer pays to have a bug fixed. Worker agents bid for the job from their own NEAR accounts and race to fix it. A foreman agent runs the tests and pays the cheapest fix that passes. The money sits in a contract the whole time, so nobody has to trust the agents with it.

Built for NEAR HACKATHON (tracks: AI Swarms, Autonomous Business, Agent Economy). Runs on NEAR testnet.

## The problem

AI agents can already fix small bugs, but you can't hire one the way you hire a contractor. There's no price, no competition and no guarantee you only pay for work that passes. SwarmShop is that market: open bids, a test suite as the judge, and escrow that pays on success or refunds on failure.

## How NEAR is used

- **Escrow contract** (`contract/`, Rust). Holds each job's budget and the acceptance test that decides it. Pays the winning worker or refunds the customer. The shop keeps the difference as margin.
- **One sub-account per agent.** Workers are `worker-ace.<shop>`, `worker-bolt.<shop>`, `worker-cid.<shop>`, and the foreman is `foreman.<shop>`. The contract only accepts bids from direct sub-accounts of the shop, so every bid and payout traces to one agent.
- **On-chain proof.** Each payout stores the SHA-256 of the winning patch, so anyone can re-run the tests and check the foreman picked right.
- **NEAR AI Cloud** is the default model endpoint for live mode.

The market rules are in [RULES.md](RULES.md).

## Try it

You need Node 24 and Rust (the contract pins 1.95 in `contract/rust-toolchain.toml`) with `cargo-near` 0.22.0.

```sh
npm install
(cd contract && cargo near build non-reproducible-wasm)
npm run setup   # creates free testnet accounts and deploys the contract
npm start       # the shop service: watches the chain, runs the agents, serves the app
```

What you should see:

1. `npm run setup` prints the shop account and writes it to `.env`. Keys stay in `~/.near-credentials/testnet/`.
2. `npm start` prints `SwarmShop <shop> (mode: sim) on http://localhost:8788`. Open that page. It offers a free testnet account (one click, the faucet funds it with 10 NEAR), a "Load an example" menu with the five demo bugs, and a Post button.
3. Post a job. The budget goes into the escrow contract. Within seconds the page shows three bids from three worker accounts, a patch and a test result per worker, then an `award` or `refund` transaction, each with a testnet explorer link. Nobody runs anything by hand: the service saw the job on-chain and the swarm handled it.
4. Post the same bug again with your own acceptance test, or a bug no scripted worker knows: in sim mode nobody passes and the contract refunds you.

Without an API key the service runs scripted workers (`sim`). With `LLM_API_KEY` and `LLM_MODEL` in `.env` it runs real AI workers (`live`); `--mode sim|live` overrides.

The service also exposes the state it shows: `GET /api/state` (jobs, bids, per-worker work and events, worker earnings), `GET /api/events` (server-sent events), `GET /api/examples`, `POST /api/accounts`.

### Scripted proof

The one-shot runner posts the five demo jobs itself and a verifier checks the outcome by reading only the chain:

```sh
npm run shop -- --mode sim  # posts the 5 demo jobs and runs the swarm on each
npm run verify              # prints `all checks passed`
npm run e2e                 # starts the service, posts 2 jobs over RPC, waits for the chain to settle them
```

`npm run shop` prints, per job, the three bids, which patches passed, and who got paid, with an explorer link for every transaction:

- Job 1: all three pass, so the cheapest (bolt, 0.3 NEAR) wins.
- Job 2: bolt's cheap fix fails, so cid (0.5 NEAR) wins.
- Job 3: only ace's careful fix passes, so ace (1.05 NEAR) wins.
- Job 4: nobody passes, so the customer gets the full 0.5 NEAR back.
- Job 5 (semver precedence): the two quick fixes fail the pre-release rules, so ace (1.4 NEAR) wins.

A v2 shop that has run all of the above is live at `v2.swarmshop-mw7wjo67.testnet`. The v1 shops are `swarmshop-mw7vilrm.testnet` (scripted workers) and `swarmshop-mw7x22yf.testnet` (real AI workers, demo video).

## Modes

- `sim` uses scripted workers with fixed bidding styles and pre-written patches in `agents/sim/`, matched by job title. It needs no API key, so anyone can reproduce the demo. Unknown titles get a no-op patch, so they fail and refund.
- `live` asks a language model for each worker's bid and patch. Each worker sees the bug, the customer's acceptance test and every file of the repo, and answers with one rewritten file. Set `LLM_API_KEY` and `LLM_MODEL` (and `LLM_BASE_URL` for a provider other than NEAR AI Cloud). Each agent can run on its own model (`LLM_MODEL_ACE`, `LLM_MODEL_BOLT`, `LLM_MODEL_CID` override `LLM_MODEL`) and has its own output budget, so a cheap agent really is cheaper and fails bigger jobs. Bad model output counts as no bid or no patch.

## Layout

- `contract/` holds the escrow contract and its unit tests (`cargo test`).
- `agents/` holds the service (`service.js`), the swarm shared by the service and the one-shot runner (`swarm.js`), the workers, the judge, and the setup, verify and e2e scripts.
- `jobs/` holds the demo jobs the app offers as examples. Each has a `job.json` and the acceptance test that decides pass or fail.
- `shop-repo/` is the small library with the bugs.
- `web/` is the app the service serves. No build step.

## Limits

- Testnet only.
- The foreman runs patches in a temp folder without a sandbox. That's fine for the demo jobs, but don't point live mode at untrusted repos.
- The contract trusts the foreman to pick the lowest passing bid. The stored patch hash makes that choice checkable, but the contract doesn't check it itself.

## License

MIT
