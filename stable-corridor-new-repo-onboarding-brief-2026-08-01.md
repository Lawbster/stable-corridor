# Stable Corridor Project — New Repository Onboarding Brief

**Prepared:** 2026-08-01  
**Status:** Research and architecture brief only  
**Execution status:** No bot exists; no capital is authorized  
**Proposed repository:** `stable-corridor`  
**Proposed VPS path:** `/opt/stable-corridor`

---

## 1. Purpose of this document

This document is the starting context for a separate AI-assisted project investigating whether a small independent operator can profitably provide liquidity or trade temporary price dislocations between:

- EURC and USDC;
- EURC and fiat EUR;
- USDC and fiat EUR/USD;
- multiple centralized exchanges and, eventually, approved issuer or FX settlement rails.

It records:

- the economic reasoning behind the project;
- what has already been checked;
- why this must be a separate repository from the live HYPE system;
- the recommended process, data, security, and deployment boundaries;
- the phased research-to-live path;
- the evidence required before any authenticated execution is built.

This is not authorization to trade, fund accounts, create API keys, or deploy a live execution process.

---

## 2. Executive view

Classic stablecoin arbitrage — notice a price difference, buy on one venue, transfer, and sell on another — is not the target. Normal price differences are usually smaller than retail trading fees and disappear before a transfer settles.

The candidate worth researching is:

> **Dislocation-only, post-only EURC/USDC market making using pre-positioned inventory, with multiple EUR/USD and stablecoin markets providing fair value.**

The potential edge is not expected to come from predicting the direction of EUR/USD or beating institutional arbitrageurs by microseconds. It would come from:

- zero or near-zero maker pricing;
- capital already positioned on multiple venues;
- temporary venue-specific inventory pressure;
- differences between European and US banking hours;
- slower rebalancing constraints;
- disciplined refusal to trade ordinary one-basis-point noise;
- strict inventory, peg, venue, and operational risk limits.

The likely initial execution venue is Coinbase Advanced because its designated stablepairs can have zero maker fees. Binance, Bybit, and Kraken initially appear more useful as price-discovery and rebalancing references than as execution venues at ordinary account fee tiers.

No edge has been proven. The next job is collection and replay, not execution.

---

## 3. Current operator access

The operator currently has accounts at:

- Coinbase;
- Binance;
- Bybit.

The operator expects to be able to open a Kraken account in Norway. Kraken currently lists Norway within its supported EEA footprint, subject to verification and account-specific restrictions.

Unknowns still requiring account-level confirmation:

- whether Coinbase Advanced exposes `EURC-USDC` and `USDC-EUR` as tradeable rather than view-only;
- the exact maker/taker fee displayed to the operator for those Coinbase markets;
- Binance account-specific fees for `EURUSDC` and `EURIUSDC`;
- SEPA deposit and withdrawal availability on Coinbase, Binance, and a future Kraken account;
- Bybit account-specific pricing for `USDCEUR`;
- whether the operator has, or could obtain through a company, Circle Mint or StableFX access.

No API keys, account identifiers, balances, or screenshots containing sensitive information belong in Git.

---

## 4. Economic model

EURC represents one euro and USDC represents one US dollar. Therefore:

```text
fair EURC/USDC price ≈ current EUR/USD exchange rate
```

The full corridor is:

```text
EUR bank balance  ←→  EURC
      ↕                 ↕
USD bank balance  ←→  USDC
```

If EUR/USD fair value is `1.1520`, one EURC should be worth approximately `1.1520` USDC. A temporary venue quote at `1.1508` would indicate EURC trading at a discount relative to that reference. A strategy might post a bid near the discounted price, acquire EURC as maker, and later exit when:

- EURC/USDC returns toward fair value;
- an opposing maker order fills;
- another inventory balance can offset the exposure economically;
- an issuer or fiat rail can complete the conversion.

Without direct issuer access, the transaction is not perfectly locked arbitrage. Owning EURC creates EUR/USD exposure until the inventory is offset. The replay must model this honestly.

---

## 5. Why inventory must be pre-positioned

The strategy cannot depend on transferring funds after observing a spread. By the time a blockchain transfer or bank movement completes, the opportunity will usually be gone.

The intended operating shape is pre-funded inventory distributed across venues:

```text
Venue A: EURC + USDC
Venue B: EUR + USDC
Venue C: reference or hedge inventory
Bank:    bounded EUR/USD operating capital
```

Execution changes the composition and location of inventory. Rebalancing happens later and separately from the time-sensitive decision.

This has two important consequences:

1. Total required capital is larger than the visible trade size.
2. Returns must be measured against all deployed capital, not only the notional of filled orders.

Illustrative basis-point economics:

```text
$30,000  × 1 bp = $3
$250,000 × 1 bp = $25
$1,000,000 × 1 bp = $100
```

One 50 bp depeg or trapped venue balance can eliminate 50 successful 1 bp cycles. Venue and peg failure containment are therefore more important than signal sophistication.

---

## 6. Point-in-time market and fee observations

These observations were collected from public product catalogs and order books on 2026-08-01. They are evidence of current market structure only, not a profitability result.

### Publicly visible market coverage

| Venue | Relevant live markets observed | Initial role |
|---|---|---|
| Coinbase | `EURC-USDC`, `USDC-EUR` | Candidate maker execution venue |
| Binance | `EURUSDC`, `EURIUSDC`, `USDCUSD` | Fair-value and liquidity reference |
| Bybit | `USDCEUR`, `USDCUSDT` | Deep reference and possible rebalance venue |
| Kraken | `EURC/USDC`, `EURC/EUR`, `EURC/USD`, `USDC/EUR`, `USDC/USD` | Complete corridor reference and fiat bridge |

### One public-book snapshot

| Market | Displayed spread | Approximate top-level liquidity |
|---|---:|---:|
| Coinbase EURC/USDC | 1.74 bp | $5k–$7k |
| Coinbase USDC/EUR | 1.15 bp | $23k–$61k |
| Binance EUR/USDC | 1.74 bp | $12k–$28k |
| Bybit USDC/EUR | 1.15 bp | $262k–$1.65m |
| Kraken EURC/USDC | 4.77 bp | $1.6k–$9.6k |

### Fee constraints

- Coinbase designated stablepairs advertise zero maker fees and low stablepair taker pricing. Account and regional treatment must be confirmed before relying on it.
- Bybit non-VIP spot pricing is 10 bp maker and 10 bp taker, which overwhelms ordinary stablecoin spreads.
- Kraken's entry stablecoin/FX tier is 20 bp for both maker and taker. It only becomes competitive at very high qualifying volume.
- Binance fees and promotions must be read from the operator's actual account. Temporary promotions must never be treated as permanent strategy edge.

The key conclusion is:

> A displayed spread is not an opportunity. Only the fee-, depth-, latency-, fill-, hedge-, inventory-, and failure-adjusted result matters.

---

## 7. Why the European corridor is interesting

USDC/USDT is an obvious same-dollar relationship monitored by large market makers. Normal spreads are extremely small and the fair value is uncomplicated.

EURC/USDC may have more structural fragmentation because it combines:

- a genuine moving EUR/USD exchange rate;
- different European and US bank operating hours;
- 24/7 crypto trading versus conventional FX market hours;
- SEPA and USD wire timing differences;
- uneven EURC liquidity between venues and chains;
- regional demand for euro versus dollar inventory;
- regulatory preference for MiCA-compliant stablecoins in the EEA;
- issuer, venue, and rebalancing access that differs across participants.

These features may create longer-lived, venue-specific dislocations. They also add FX and inventory risk. This is a research rationale, not a claim that the edge exists.

---

## 8. Proposed strategy families

### 8.1 Primary candidate: dislocation-only maker

Do not quote continuously. Wait until one venue diverges materially from a multi-source fair value, then post a maker order toward fair value.

Conceptual decision:

```text
expected net edge =
    observed dislocation
  - maker fee
  - expected hedge cost
  - expected adverse selection
  - queue and fill uncertainty
  - inventory financing cost
  - rebalance cost
  - explicit risk buffer
```

Trade only when the result remains positive under conservative assumptions.

### 8.2 Secondary candidate: passive two-sided market making

Continuously quote a bid and ask around fair value, skewing quotes based on inventory.

This may generate more fills but is more exposed to adverse selection when EUR/USD moves or informed flow arrives. It should be tested after the dislocation-only candidate, not first.

### 8.3 Possible institutional extension

If a company becomes eligible for Circle Mint or StableFX, direct USDC/EURC conversion and net settlement may improve:

- conversion certainty;
- capital efficiency;
- inventory rebalancing;
- the strength of the redemption anchor.

This is a later access path, not an assumption in the initial replay.

### 8.4 Explicitly rejected starting approaches

- Taker arbitrage followed by inter-exchange transfer.
- Assuming stablecoins always redeem immediately at par.
- Leveraged stablecoin mean reversion.
- Averaging into a depeg.
- Pure DEX/CEX latency competition as the first project.
- Strategies whose profitability depends on a temporary fee promotion.
- Replays with infinite inventory or instantaneous free rebalancing.

---

## 9. Repository decision

Create a completely separate private Git repository.

Local layout:

```text
C:\Users\emile\dev\Venzen\venzen-finance\
├── reverse-copy\
└── stable-corridor\
```

VPS layout:

```text
/opt/bybit-rev
/opt/stable-corridor
```

Do not add this project under `reverse-copy/src/`.

Reasons:

- The HYPE system is already live and operationally complex.
- The projects use different exchanges, credentials, state, data, and capital.
- Stable-corridor deployments must not rebuild or restart HYPE.
- Research dependencies and data retention needs will differ.
- Git history, rollbacks, incidents, and AI context stay coherent.
- A fault or compromised credential in one system has a smaller blast radius.

Reuse architectural lessons, not a runtime code dependency. Do not create a shared package or monorepo until repeated, stable common code actually exists.

---

## 10. Recommended repository structure

```text
stable-corridor/
├── AGENTS.md
├── CLAUDE.md
├── README.md
├── PROJECT_STATUS.md
├── package.json
├── tsconfig.json
├── config/
│   ├── collector.example.json
│   ├── shadow.example.json
│   └── live.example.json
├── src/
│   ├── collector/
│   ├── venues/
│   ├── fair-value/
│   ├── opportunity/
│   ├── replay/
│   ├── inventory/
│   ├── risk/
│   └── health/
├── scripts/
├── research/
├── backtests/
└── docs/
    └── operations/
```

Do not create `src/execution/` or authenticated trading clients during the first collection phase. Add them only after the research gate explicitly approves live architecture work.

---

## 11. Process boundaries

### Initial PM2 topology

```text
stable-corridor-collector
stable-corridor-shadow
stable-corridor-watchdog
```

### Possible future topology

```text
stable-corridor-live
```

Ownership rules:

- **Collector:** public market data only; cannot authenticate or trade.
- **Shadow:** reads normalized data and produces hypothetical decisions and simulated inventory changes.
- **Watchdog:** reads health artifacts and sends alerts; cannot trade, restart PM2, or write control signals.
- **Live owner:** future sole execution owner with transactional state and reconciliation.

The live owner must not exist during the initial research phase. This is an intentional structural safety control.

All processes may use the existing `pm2-deploy.service`, but must have:

- unique names;
- `/opt/stable-corridor` as working directory;
- independent logs and health files;
- independent build and restart commands;
- no imports or filesystem dependencies from `/opt/bybit-rev`.

Never use `pm2 restart all` for either project.

---

## 12. Credentials and account isolation

Phase 1 uses public feeds and requires no exchange API keys.

If execution is eventually approved:

- use a separate Coinbase Advanced portfolio and API key;
- use a separate Bybit subaccount from all HYPE derivatives activity;
- use a Binance subaccount if available, otherwise a tightly scoped dedicated API key;
- use a dedicated Kraken API key;
- allow spot trading only;
- disable withdrawals on every trading key;
- use separate keys for read-only account telemetry and order execution where supported;
- keep stable-corridor secrets out of the HYPE `.env`;
- never log secrets, signed requests, or raw authenticated responses without redaction.

Proposed secret file:

```text
/opt/stable-corridor/.env
```

with:

```bash
chmod 600 /opt/stable-corridor/.env
```

No process may share or import `/opt/bybit-rev/.env`.

---

## 13. Durable state and data paths

Preferred production separation:

```text
/var/lib/stable-corridor/
├── data/
├── state/
└── incidents/
```

During the read-only prototype, ignored repo-local directories are acceptable if clearly documented:

```text
/opt/stable-corridor/data/
/opt/stable-corridor/state/
```

Live state must eventually be outside the Git lifecycle or explicitly protected from pulls, cleans, builds, and deployments.

All state writes must be:

- atomic;
- versioned;
- crash-safe;
- append-audited where decisions or fills are concerned;
- restorable from exchange evidence after restart.

---

## 14. Data collection design

The collector should capture enough information to replay maker execution without retaining unbounded full-depth traffic.

Recommended raw inputs:

- public order-book snapshots and deltas;
- public trades;
- source timestamps and local receive timestamps;
- venue connection and sequence health;
- relevant pair status;
- deposit/withdrawal status where a reliable public endpoint exists;
- conventional EUR/USD reference data with clear source timing.

Recommended derived streams:

- best bid/ask;
- spread and top-N executable depth;
- order-book imbalance and replenishment;
- aggressive buy/sell flow;
- cross-venue fair value;
- fee-adjusted opportunity state;
- hypothetical order lifecycle;
- simulated per-venue inventory;
- data health and coverage.

Storage rules:

- use UTC epoch milliseconds;
- preserve both exchange time and local receive time;
- rotate journals daily;
- compress completed days;
- maintain periodic order-book checkpoints for delta recovery;
- bound depth and retention;
- record raw high-frequency detail around candidate dislocations;
- never allow disk pressure to affect the HYPE processes.

The shared VPS currently has enough room for a bounded initial collector, but four-venue full-depth retention could grow rapidly. CPU, memory, disk, network, and event-loop lag must be measured from the first deployment.

---

## 15. Replay and research integrity

No look-ahead bias is permitted.

Every historical decision must use only information received by that decision timestamp. The replay must model:

- actual fee tier;
- post-only rejection;
- queue position uncertainty;
- partial fills;
- price movement before cancellation reaches the venue;
- venue-specific tick and lot sizes;
- stale and disconnected feeds;
- bounded per-venue inventory;
- real transfer and rebalance delays;
- unavailable withdrawals;
- asynchronous fills across venues;
- EUR/USD movement while inventory is held;
- peg dislocations and depeg stop conditions;
- capital stranded on one venue;
- total capital deployed across all venues.

Do not treat touching a quoted price as a guaranteed maker fill. At minimum, use conservative queue assumptions and report results across more than one fill model.

Research output must separate:

- displayed opportunity;
- theoretically executable opportunity;
- simulated fill;
- completed inventory cycle;
- net PnL after every modeled cost.

---

## 16. Phased implementation path

### Stage A — Access audit and skeleton

Deliverables:

- confirm market access and account-specific fee treatment;
- create repository instructions and status documents;
- define normalized schemas;
- define public-only process boundaries;
- create test and build gates;
- document VPS paths and PM2 names.

No authenticated clients.

### Stage B — Public collector

Deliverables:

- reliable WebSocket/REST adapters;
- deterministic normalized journals;
- gap, sequence, and stale-data detection;
- bounded storage and rotation;
- collector health snapshot;
- fixture-based adapter tests.

No strategy decisions and no authenticated clients.

### Stage C — Fair value and opportunity shadow

Deliverables:

- multi-source EUR/USD fair value;
- explicit fee and depth model;
- dislocation-only policy;
- hypothetical post-only orders;
- finite inventory simulation;
- atomic shadow health and decision journals;
- alert-only watchdog.

No live orders.

### Stage D — Forward observation and replay

Minimum observation target:

- 45–60 days;
- normal weekdays;
- weekends;
- European and US banking cutoffs;
- volatile crypto sessions;
- at least one material EUR/USD move;
- if observed, a stablecoin or venue-specific stress episode.

Deliverables:

- fee-adjusted opportunity frequency;
- opportunity duration distribution;
- results by trade size;
- fill-model sensitivity;
- inventory holding-time distribution;
- return on total deployed capital;
- per-week and per-regime stability;
- tail and venue-failure stress results;
- clean negative result if no candidate passes.

### Stage E — Execution architecture review

Only begins if Stage D passes.

Deliverables:

- transactional order coordinator design;
- durable pending intent and receipt model;
- startup and periodic reconciliation;
- unknown-submit handling;
- partial-fill and cancel races;
- per-venue inventory ownership;
- peg, FX, venue, and operational circuit breakers;
- crash-point test matrix;
- independent safety review.

Still no funded deployment.

### Stage F — Constrained live pilot

Requires explicit separate approval.

Initial requirements:

- isolated accounts and trade-only keys;
- withdrawals disabled;
- minimal notional;
- one execution venue and one candidate;
- strict daily and inventory loss limits;
- health-confirmed startup;
- manual arming;
- documented stop and reconciliation runbook;
- no automated PM2 remediation.

Scale only from realized, reconciled evidence.

---

## 17. Research go/no-go gate

A candidate may proceed toward execution architecture only if:

1. It is net positive after exact fees, conservative fills, slippage, rebalancing, and inventory costs.
2. Returns are measured against total deployed capital.
3. Profitability is not concentrated in one isolated day or event.
4. No important observation period is materially worse without an explainable mechanism.
5. Results survive conservative queue and latency assumptions.
6. Inventory remains bounded without imaginary instant transfers.
7. The strategy does not rely on a temporary promotion.
8. Tail stress does not erase an unreasonable number of normal wins.
9. The operational design can fail closed without touching the HYPE system.
10. A no-look-ahead trace of representative decisions passes review.

If these conditions fail, the result is **not viable at current access and fee tiers**. That is a useful result and should end or redirect the project without stretching a marginal signal into a live candidate.

---

## 18. Operational safety principles inherited from HYPE

The project should adopt these proven principles:

- One process owns each live position or inventory mutation.
- Exchange acceptance is not treated as a fill.
- Local state commits only from durable exchange evidence.
- Pending intent survives crashes until resolved.
- “Not found” alone never proves rejection.
- Startup and periodic reconciliation use exact quantity tolerances.
- Unknown state enters recovery and blocks new risk.
- Native protection requires exact evidence.
- Health publication is best-effort and cannot crash execution.
- The watchdog is read-only and alert-only.
- No process restarts or signal-file actions occur automatically.
- Deployment changes only the named process.

Stablecoin-specific additions:

- no averaging into a depeg;
- no new orders when fiat, peg, venue, or book data is stale;
- no quoting when deposit/withdrawal state makes inventory one-way;
- independent limits for venue exposure, currency exposure, and total inventory;
- issuer and venue events can override ordinary price-reversion assumptions.

---

## 19. AI collaboration and administration

Use a separate AI project/context for `stable-corridor`.

Recommended conversation roles:

1. **Main pilot:** architecture, implementation, deployment, and project status.
2. **Research:** fee replay, market microstructure, inventory simulation, and findings.
3. **Safety review:** read-only review of transaction, reconciliation, and deployment changes.

The repository, not chat history, is authoritative.

Every new conversation should first read:

```text
AGENTS.md
PROJECT_STATUS.md
research/current-findings.md
docs/operations/vps.md
```

`PROJECT_STATUS.md` should remain concise:

```text
Current phase: read-only collection
Live execution: nonexistent
Deployed commit: <sha or not deployed>
PM2 processes: <names or none>
Current finding: no proven net edge yet
Next gate: <specific evidence requirement>
```

Working rules:

- only one AI builder owns an active branch/worktree at a time;
- reviewers remain read-only or use separate Git worktrees;
- research findings go into Markdown/CSV artifacts, not only chat;
- deployed commit and PM2 topology are documented;
- no agent is authorized to fund an account, create API keys, or arm execution from this brief;
- strategy research and production safety reviews remain separate tasks.

---

## 20. Suggested first assignment for the new repo AI pilot

Paste the following after creating the empty repository and attaching this document:

> Read this onboarding brief completely. Treat it as project context, not authorization to trade.
>
> First task: produce a Stage A implementation plan for a separate TypeScript `stable-corridor` repository. The plan must cover the public-only collector architecture, normalized event schemas, initial market universe, bounded storage, health telemetry, replay integrity, tests, PM2 process boundaries, and VPS deployment layout.
>
> Hard constraints:
>
> - No authenticated exchange clients.
> - No order or withdrawal code.
> - No live execution process.
> - No changes to `/opt/bybit-rev` or the `reverse-copy` repository.
> - No assumption that a displayed spread is fillable.
> - UTC epoch milliseconds and no look-ahead.
> - Finite inventory and account-specific fee modeling from the start.
> - Collector, shadow, and watchdog must remain separate processes.
>
> Deliver the plan as `research/stage-a-collector-implementation-plan.md`. Do not implement until the plan is reviewed.

---

## 21. Primary references

- Coinbase Advanced overview and API capability:  
  https://help.coinbase.com/en/getting-started/other/coinbase-vs-coinbase-advanced
- Coinbase Exchange and stablepair fees:  
  https://help.coinbase.com/en/exchange/trading-and-funding/exchange-fees
- Bybit spot fee schedule:  
  https://www.bybit.com/en/help-center/article/Bybit-Spot-Fees-Explained
- Kraken stablecoin/FX fee explanation:  
  https://support.kraken.com/articles/360039299431-how-do-stablecoin-fx-fees-work-
- Kraken fee schedule:  
  https://www.kraken.com/features/fee-schedule
- Kraken jurisdiction and EEA coverage:  
  https://support.kraken.com/articles/where-is-kraken-licensed-or-regulated
- Circle EURC:  
  https://www.circle.com/eurc
- Circle Mint eligibility:  
  https://www.circle.com/circle-mint
- Circle StableFX technical guide:  
  https://developers.circle.com/stablefx/concepts/technical-guide
- Execution-aware cross-exchange stablecoin arbitrage research:  
  https://proceedings.mlr.press/v318/litvin26a.html

---

## 22. Current recommendation

Proceed with a separate repository and a public-data-only Stage A/B build.

Do not fund or build execution yet. The immediate objective is to learn whether account-specific zero-maker access plus observed dislocation duration can produce a robust fee-adjusted edge under finite inventory and conservative fill assumptions.

The HYPE system remains operationally and financially independent throughout.
