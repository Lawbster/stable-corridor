# Stable Corridor Agent Instructions

## Required reading

Before making project changes, read:

1. `stable-corridor-new-repo-onboarding-brief-2026-08-01.md`
2. `PROJECT_STATUS.md`
3. `research/current-findings.md`
4. `docs/operations/vps.md`

The repository is authoritative when chat context and repository state differ.

## Current authority

The broad Stage B collector and passive Coinbase/Jupiter information gates
are complete. The only approved continuation is a bounded Stage C1 public
anomaly-persistence probe using Coinbase `EURC-USDC` and quote-only Jupiter
`EURC-USDC`. The named collector remains the sole process; no general shadow,
watchdog, transaction-construction, or execution process is deployed.

Authorized work:

- public-market-data architecture and research planning;
- local TypeScript toolchain and normalized schema implementation;
- deterministic append-only journal, crash-tail recovery, atomic health, and offline test implementation;
- maintenance of the public, unauthenticated Coinbase adapter for `EURC-USDC` and `USDC-EUR`;
- maintenance of the public, unauthenticated Binance adapter for `EURUSDC`, `EURIUSDC`, and `USDCUSD`;
- maintenance of the public, unauthenticated Bybit adapter for `USDTEUR`, `USDCEUR`, and `USDCUSDT`;
- maintenance of the public, unauthenticated Kraken adapter for `EURC/USDC`, `EURC/EUR`, `EURC/USD`, `USDC/EUR`, and `USDC/USD`;
- bounded public-only collector orchestration, periodic checkpoints, health, storage measurement, and venue reconnects;
- optional venue blocks and non-empty approved product subsets so a reviewed run can omit irrelevant feeds;
- the public-only Coinbase/Jupiter 3 bp anomaly comparator, append-only `cex_dex_probe` decisions, and exactly three rate-limited same-route requotes;
- offline separation and reporting of baseline Jupiter samples and explicitly linked anomaly follow-ups;
- the reviewed user-level daily compression timer, with source reclamation remaining manual and checksum-gated;
- the named `stable-corridor-collector` PM2 artifact and its targeted pilot runbook;
- repository documentation and public-only scaffolding;
- test, storage, replay, telemetry, and deployment design;
- sanitized recording of account-level market and fee facts.

The operator may maintain the reviewed bounded collector pilot and pull its
public runtime artifacts into ignored local directories. Any additional
venue, conventional FX source, shadow process, strategy logic, or materially
different deployment requires a separate reviewed gate.

Not authorized:

- authenticated exchange clients;
- API key creation or use;
- Jupiter taker, wallet, transaction construction, signing, simulation, or submission;
- order, cancel, transfer, withdrawal, or funding code;
- live or paper-to-live execution processes;
- changes to `/opt/bybit-rev` or the `reverse-copy` repository;
- funding accounts or arming any strategy.

Do not create `src/execution/`. Do not add authentication or signing dependencies during Stage A or B. A displayed spread must never be described as a fillable or profitable opportunity without the required fee, depth, latency, queue, hedge, inventory, and failure adjustments.

## Project isolation

`stable-corridor` is independent of the live HYPE system:

- no imports from `reverse-copy`;
- no filesystem dependency on `/opt/bybit-rev`;
- no shared environment file, credentials, runtime state, process names, or deployment command;
- never use `pm2 restart all`;
- deployment and restart commands must target one named Stable Corridor process.

## Data and replay rules

- Use UTC epoch milliseconds for machine timestamps.
- Preserve both exchange/source time and local receive time.
- Replay decisions may use only events received by the decision timestamp.
- Represent prices and quantities as decimal strings at persistence boundaries.
- Preserve venue sequence and connection-session information.
- Model finite, venue-specific inventory and versioned account-specific fees.
- Unknown fees, stale data, gaps, or unavailable inventory make a candidate ineligible.
- State and health writes must be atomic; decision journals must be append-audited.

## Process ownership

- `stable-corridor-collector`: public data only.
- `stable-corridor-shadow`: future hypothetical decisions and simulated inventory only.
- `stable-corridor-watchdog`: future read-only health monitoring and alerts only.
- `stable-corridor-live`: nonexistent and may not be introduced without a passed Stage D gate and explicit approval.

The watchdog may not trade, restart PM2, or write control signals.

## Working agreement

- Keep `PROJECT_STATUS.md` concise and current.
- Put durable findings in `research/`, not only in chat.
- Keep account identifiers, balances, API keys, secrets, and sensitive screenshots out of Git.
- Do not claim account access or a fee tier until the operator has verified it.
- Add dependencies and runtime configuration only after the Stage A plan is reviewed.
- Prefer fixture-based deterministic tests before network integration tests.
- A clean negative result is a valid outcome.
