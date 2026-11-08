# SwarmShop

A bug-fixing shop run by a swarm of AI agents on NEAR. A customer pays to have a bug fixed. Worker agents bid for the job from their own NEAR accounts and race to fix it. A foreman agent runs the tests and pays the cheapest fix that passes. The money sits in a contract the whole time, so nobody has to trust the agents with it.

Built for NEAR HACKATHON (tracks: AI Swarms, Autonomous Business, Agent Economy). Runs on NEAR testnet.

## The problem

AI agents can already fix small bugs, but you can't hire one the way you hire a contractor. There's no price, no competition and no guarantee you only pay for work that passes. SwarmShop is that market: open bids, a test suite as the judge, and escrow that pays on success or refunds on failure.

## How NEAR is used

- **Escrow contract** (`contract/`, Rust). Holds each job's budget. Pays the winning worker or refunds the customer. The shop keeps the difference as margin.
- **One sub-account per agent.** Workers are `worker-ace.<shop>`, `worker-bolt.<shop>`, `worker-cid.<shop>`, and the foreman is `foreman.<shop>`. The contract only accepts bids from direct sub-accounts of the shop, so every bid and payout traces to one agent.
- **On-chain proof.** Each payout stores the SHA-256 of the winning patch, so anyone can re-run the tests and check the foreman picked right.
- **NEAR AI Cloud** is the default model endpoint for live mode.

The market rules are in [RULES.md](RULES.md).

## Try it

You need Node 24 and Rust (the contract pins 1.95 in `contract/rust-toolchain.toml`) with `cargo-near` 0.22.0.

```sh
npm install
(cd contract && cargo near build non-reproducible-wasm)
npm run setup               # creates free testnet accounts and deploys the contract
npm run shop -- --mode sim  # runs the 4 demo jobs end to end on testnet
npm run verify              # checks the results by reading the chain
```

What you should see:

1. `npm run setup` prints the shop account and writes it to `.env`. Keys stay in `~/.near-credentials/testnet/`.
2. `npm run shop` posts 4 jobs from `jobs/`. For each one it prints the three bids, which patches passed the tests, and who got paid, with a testnet explorer link for every transaction.
   - Job 1: all three pass, so the cheapest (bolt, 0.3 NEAR) wins.
   - Job 2: bolt's cheap fix fails, so cid (0.5 NEAR) wins.
   - Job 3: only ace's careful fix passes, so ace (1.05 NEAR) wins.
   - Job 4: nobody passes, so the customer gets the full 0.5 NEAR back.
3. `npm run verify` reads only the contract and account balances and prints `all checks passed`.

To watch it live, serve the page and open it with your shop account:

```sh
python3 -m http.server 8765 --directory web
# open http://localhost:8765/?contract=<SHOP_ACCOUNT from .env>
```

The page shows every job, every bid sorted by price, the winner, the clearing price, the shop's margin and each worker's earnings. It refreshes every 5 seconds.

A shop that has already run the demo is live at `swarmshop-mw7vilrm.testnet`.

## Modes

- `--mode sim` (default) uses scripted workers with fixed bidding styles and pre-written patches in `agents/sim/`. It needs no API key, so anyone can reproduce the demo.
- `--mode live` asks a language model for each worker's bid and patch. Set `LLM_API_KEY` and `LLM_MODEL` (and `LLM_BASE_URL` for a provider other than NEAR AI Cloud). Bad model output counts as no bid or no patch.

## Layout

- `contract/` holds the escrow contract and its unit tests (`cargo test`).
- `agents/` holds the setup, workers, foreman, runner and verify scripts.
- `jobs/` holds the demo jobs. Each has a `job.json` and the acceptance test that decides pass or fail.
- `shop-repo/` is the small library with the bugs.
- `web/index.html` is the live page. One file, no build step.

## Limits

- Testnet only.
- The foreman runs patches in a temp folder without a sandbox. That's fine for the demo jobs, but don't point live mode at untrusted repos.
- The contract trusts the foreman to pick the lowest passing bid. The stored patch hash makes that choice checkable, but the contract doesn't check it itself.

## License

MIT
