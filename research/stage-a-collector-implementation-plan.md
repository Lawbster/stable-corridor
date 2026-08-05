# Stage A Public Collector Implementation Plan

**Status:** Approved; four-venue bounded public collector install-ready locally
**Prepared:** 2026-08-01
**Approved:** 2026-08-02
**Implementation authorization:** A1-A5 public-only collector work completed locally; operator installation is next
**Live execution:** Nonexistent and out of scope

## Implementation record

The approved A1/A2 slice now includes:

- a pinned Node.js 24 LTS target, TypeScript toolchain, lockfile, offline gates, and production dependency allowlist;
- strict normalized event, configuration, and health schemas;
- canonical decimal strings and deterministic JSON serialization;
- receive-time replay ordering and a no-look-ahead sentinel test;
- append-only journal routing, UTC-day and size rotation, checksummed metadata, interrupted-tail recovery, and path containment;
- atomic health publication with a best-effort failure seam;
- 45 passing unit, integration, and replay tests across 7 files.

During A1/A2, no venue adapter, network connection, authenticated client, deployment artifact, PM2 process, or execution module was added.

The approved A3 slice now also includes:

- a public, unauthenticated Coinbase Advanced Trade WebSocket adapter for `EURC-USDC` and `USDC-EUR`;
- public product metadata from the Advanced Trade public REST endpoint;
- bounded L2 reconstruction with absolute-quantity updates, zero removal, and crossed-book rejection;
- trade, status, and heartbeat normalization with source and receive timestamps;
- connection sequence, trade-ID, staleness, availability, frame-size, and tracked-level fail-closed controls;
- recorded, truncated public fixtures and byte-identical normalized-journal integration coverage;
- 75 passing unit, integration, and replay tests across 13 files.

A3 added no authenticated client, order path, deployment artifact, PM2 process, or execution module.

The approved first A4 reference slice now also includes:

- public, unauthenticated Binance metadata for `EURUSDC`, `EURIUSDC`, and `USDCUSD`;
- combined diff-depth and raw-trade streams on the market-data-only host;
- bounded WebSocket buffering plus REST snapshot synchronization using Binance update IDs;
- product mapping, filter, status, trade-ID, staleness, reconnect, crossed-book, and response/frame bounds;
- deterministic fixtures and byte-identical normalized-journal coverage;
- 99 passing unit, integration, and replay tests across 19 files.

The Binance slice added no authenticated client, order path, deployment artifact, PM2 process, or execution module.

The approved second A4 reference slice now also includes:

- public, unauthenticated Bybit spot metadata for `USDTEUR`, `USDCEUR`, and `USDCUSDT`;
- public 200-level order-book snapshots/deltas and public trades over the spot WebSocket;
- strict update-ID continuity, increasing cross-sequence validation, service-reset snapshots, trade deduplication, staleness checks, and application heartbeat;
- product mapping, asset-contract, subscription, frame/response, crossed-book, and tracked-state bounds;
- deterministic recorded fixtures and byte-identical normalized-journal coverage;
- 123 passing unit, integration, and replay tests across 25 files.

The Bybit slice added no authenticated client, order path, transfer path, deployment artifact, PM2 process, or execution module.

The approved final A4 reference slice now also includes:

- public Kraken metadata and WebSocket v2 book/trade streams for all five approved products;
- lossless decimal parsing and transactional unsigned CRC32 validation at subscribed depth 25;
- local per-connection book ordinals, trade-ID continuity, bounded deduplication, acknowledgements, heartbeat, status, and staleness handling;
- deterministic recorded fixtures and normalized-journal integration coverage.

The approved A5 readiness slice now also includes:

- one public-only runner with per-venue reconnects and one globally ordered event sink;
- 60-second bounded checkpoints across all four venues;
- startup and periodic 10 GiB data/40 GiB reserve storage gates;
- atomic health with feed eligibility, storage, memory, event-loop lag, and journal metrics;
- one named PM2 artifact with automatic restart disabled;
- targeted installation, operation, rollback, and 24/48/72-hour measurement instructions;
- a public-network durability smoke in which all 13 feeds became healthy with zero journal errors.
- 177 passing unit, integration, and replay tests across 40 files.

No authenticated client, account read, order path, transfer path, execution
module, shadow strategy, or deployed process was added.

## 1. Outcome of Stage A

Stage A established a reviewed specification for a separate TypeScript repository and authorized its public-data-only A1/A2 foundation.

The review must approve:

- public-only process and module boundaries;
- normalized event schemas and deterministic ordering;
- the initial market universe and adapter sequence;
- bounded storage and retention budgets;
- atomic health telemetry;
- no-look-ahead replay guarantees;
- test and build gates;
- PM2 names and VPS paths;
- treatment of account-specific fees and finite inventory.

Stage A does not connect to an authenticated endpoint, place or simulate submitting an exchange order, move funds, create API keys, or deploy a process.

## 2. Hard boundaries

1. No authenticated exchange clients or request signing.
2. No order, cancel, transfer, deposit, withdrawal, or funding code.
3. No `src/execution/` and no `stable-corridor-live` process.
4. No dependency on `reverse-copy`, `/opt/bybit-rev`, its environment, state, or PM2 processes.
5. No assumption that displayed spread is executable.
6. All machine timestamps use UTC epoch milliseconds.
7. Historical decisions use receive-time information only; no look-ahead.
8. Inventory is finite and tracked per venue, asset, and account model.
9. Fees are versioned, account-specific research inputs; unknown fees fail closed.
10. Collector, shadow, and watchdog are distinct processes with one-way, least-authority responsibilities.

## 3. Proposed build sequence

### A0 — plan review

- Review this document.
- Complete or explicitly defer the decisions in section 15.
- Review the sanitized account audit separately from public collector work.
- Approve the exact first implementation slice.

### A1 — repository toolchain

After review, add a pinned Node.js runtime major, TypeScript, a lockfile, formatting, linting, schema validation, and a test runner. The runtime version must match an explicit VPS inventory check rather than an assumed server version.

The first scripts should be deterministic and non-networked:

```text
format:check
lint
typecheck
test:unit
test:integration
test:replay
build
check
```

`check` must run every required gate and must not rely on credentials.

### A2 — schema and journal core

- Implement decimal-string validation and timestamp rules.
- Implement normalized event validation and serialization.
- Implement deterministic ingest ordering.
- Implement append-only journal writing, rotation, checkpoint metadata, compression handoff, and recovery of an interrupted final record.
- Implement atomic health publication.
- Prove the core with generated fixtures before adding a venue adapter.

### A3 — first public adapter

**Completed locally on 2026-08-02.**

Start with Coinbase public market data for `EURC-USDC` and `USDC-EUR`, subject to verifying that the chosen public API supports the required book semantics.

- Capture public product metadata, snapshots/deltas, trades, sequence state, exchange time, and local receive time.
- Normalize without discarding venue-native identifiers.
- Detect gaps, out-of-order updates, staleness, reconnects, and invalid crossed books.
- Journal deterministic fixtures from recorded, non-sensitive public messages.

### A4 — reference adapters

**Binance, Bybit, and Kraken slices completed locally on 2026-08-02.**

Add one venue at a time, each behind the same normalized contract:

1. Binance public references.
2. Bybit public references.
3. Kraken public references.
4. Conventional EUR/USD reference once source, license, timestamps, and outage behavior are approved.

An adapter is not accepted until its fixture suite, gap recovery, health behavior, and storage profile pass.

### A5 — bounded forward-collection readiness

- Measure CPU, memory, network, event-loop lag, journal throughput, compression ratio, and disk growth locally or in an isolated staging run.
- Set explicit byte and free-space budgets from the measurement.
- Document targeted deployment and rollback.
- Approve only the named collector for Stage B deployment.

Shadow and watchdog code remain deferred to Stage C, but their boundaries and health contracts are defined now to prevent the collector from accumulating strategy or alert authority.

## 4. Public-only architecture

```text
Public WS/REST
      |
      v
Venue transport -> venue parser -> sequence/book reconciler
                                      |
                                      v
                             normalized validation
                                /           \
                               v             v
                     append-only journal   atomic health
                               |
                               v
                      later replay/shadow reader
```

### Collector responsibilities

- open public WebSocket/REST connections;
- timestamp receipt immediately;
- validate and normalize messages;
- maintain only the book state required to verify and bound captured depth;
- detect sequence gaps, stale feeds, crossed books, reconnects, and journal failures;
- write deterministic append-only events and atomic health snapshots;
- stop publishing eligible data when correctness is uncertain.

### Collector prohibitions

- no credentials, signing, account telemetry, balances, orders, strategies, fair-value decisions, simulated fills, alerts, or PM2 control;
- no direct mutation of shadow or watchdog state;
- no imports from later execution-oriented modules.

### Later process boundaries

| Process | Earliest stage | Reads | Writes | Explicitly cannot |
|---|---:|---|---|---|
| `stable-corridor-collector` | B | public market sources, public config | normalized journals, collector health | authenticate, decide trades, alert, control PM2 |
| `stable-corridor-shadow` | C | immutable normalized data, fee/inventory config | hypothetical decisions, simulated inventory, shadow health | submit orders or mutate collector data |
| `stable-corridor-watchdog` | C | process health artifacts | alerts and its own health | trade, restart PM2, write control signals |
| `stable-corridor-live` | F only | not designed in Stage A | nonexistent | exist before explicit later approval |

Processes communicate through versioned, append-only data or read-only health artifacts. They do not share mutable in-memory state.

## 5. Proposed module boundaries

```text
src/
  collector/      orchestration, connections, ingest clock, journal routing
  venues/         public adapters and venue-native parsing
  fair-value/     Stage C; multi-source fair value only
  opportunity/    Stage C; hypothetical policy only
  replay/         event clock, deterministic readers, fill-model interfaces
  inventory/      finite per-venue simulation
  risk/           eligibility and stress rules
  health/         schemas, atomic publication, stale-state evaluation
tests/
  fixtures/       sanitized public messages and expected normalized events
  unit/           pure validators, parsers, order-book logic
  integration/    local fake streams, journal/health filesystem behavior
  replay/         no-look-ahead and deterministic replay proofs
```

There is intentionally no shared runtime package with the HYPE system and no execution module.

## 6. Normalized event design

Persisted prices, sizes, fees, and notionals use canonical decimal strings. JavaScript floating-point values may not cross a persisted schema boundary. Asset and product identifiers are canonicalized while native venue identifiers are preserved.

### Common envelope

Every normalized event has:

| Field | Type | Rule |
|---|---|---|
| `schemaVersion` | integer | starts at `1`; migrations are explicit |
| `eventType` | enum | one of the approved event payload types |
| `venue` | enum/string | stable canonical venue identifier |
| `product` | string | canonical `BASE-QUOTE` |
| `nativeProduct` | string | exact public venue identifier |
| `sourceTimestampMs` | integer or null | source-provided UTC epoch ms; null is explicit |
| `receivedTimestampMs` | integer | captured at the transport boundary |
| `ingestSequence` | integer | locally monotonic within one collector run |
| `connectionId` | string | random run/session identifier; contains no account data |
| `venueSequence` | string or null | string preserves large integers and composite IDs |
| `source` | enum | `websocket`, `rest`, or approved external feed |
| `payload` | tagged object | event-specific validated data |

`receivedTimestampMs` is the replay availability time. `sourceTimestampMs` may be used for latency analysis but never to make an event available earlier in replay. Ties are resolved by `ingestSequence`, then a documented stable file-order fallback.

### Initial event types

1. `instrument`
   - base/quote assets;
   - public trading status;
   - tick size, quantity step, min/max quantity and notional when public;
   - effective observation time.
2. `book_checkpoint`
   - bounded bid and ask levels;
   - source sequence;
   - requested/received depth;
   - checksum where supported.
3. `book_delta`
   - absolute or relative update semantics explicitly tagged;
   - bounded price-level changes;
   - sequence range where supplied.
4. `trade`
   - trade ID where supplied;
   - price and quantity decimal strings;
   - aggressor side only when the venue defines it reliably.
5. `market_status`
   - public product availability or maintenance state;
   - reason/source when supplied.
6. `feed_status`
   - connecting, healthy, stale, gapped, recovering, or stopped;
   - last good sequence and explicit ineligibility reason.
7. `public_rail_status`
   - optional and only from a reliable public endpoint;
   - asset/network deposit or withdrawal status;
   - never interpreted as account-specific availability.

Raw venue frames may be retained only within the approved bounded diagnostic policy. Normalized journals are the replay contract.

### Derived events, deferred to Stage C

- top-of-book and executable top-N depth;
- aggressive flow and replenishment;
- fair-value observation with contributing source IDs;
- fee-adjusted opportunity state;
- hypothetical order lifecycle;
- simulated inventory mutation;
- decision trace and health.

Every derived event records the maximum input `receivedTimestampMs`, the exact source event references or journal offsets, and a configuration hash.

## 7. Initial market universe

### Priority 0 — candidate and direct exit reference

| Venue | Native product | Canonical product | Initial use |
|---|---|---|---|
| Coinbase | `EURC-USDC` | `EURC-USDC` | candidate public book |
| Coinbase | `USDC-EUR` | `USDC-EUR` | direct fiat/stable reference |

### Priority 1 — EUR/USD and stablecoin references

| Venue | Native product | Canonical product | Initial use |
|---|---|---|---|
| Binance | `EURUSDC` | `EUR-USDC` | EUR/USDC fair-value reference |
| Binance | `EURIUSDC` | `EURI-USDC` | euro-stablecoin reference |
| Binance | `USDCUSD` | `USDC-USD` | dollar anchor reference |
| Bybit | `USDTEUR` | `USDT-EUR` | secondary EUR/stablecoin reference |
| Bybit | `USDCEUR` | `USDC-EUR` | deep EUR/USDC reference |
| Bybit | `USDCUSDT` | `USDC-USDT` | dollar-stablecoin stress reference |
| Kraken | `EURC/USDC` | `EURC-USDC` | independent corridor book |
| Kraken | `EURC/EUR` | `EURC-EUR` | EURC peg reference |
| Kraken | `USDC/EUR` | `USDC-EUR` | EUR/USD corridor reference |
| Kraken | `USDC/USD` | `USDC-USD` | USDC peg reference |

`EURC/USD` was added after public metadata confirmed the exact native symbol
and online status. Product status remains a live eligibility requirement.

### External EUR/USD

A conventional EUR/USD source is required for robust fair value but is not selected in Stage A. Approval requires:

- clear redistribution and retention rights;
- source and receive timestamps;
- documented trading-hours and weekend behavior;
- outage/stale semantics;
- enough resolution for the intended replay;
- a cost that is included in research economics.

Crypto-derived EUR/USD and conventional FX must remain distinguishable inputs, particularly during weekends and bank holidays.

## 8. Fee and inventory inputs from the start

The public collector does not read accounts. Account-specific facts are supplied as sanitized, versioned research configuration after operator verification.

### Fee schedule fields

```text
venue
product or fee group
makerBps
takerBps
effectiveFromMs
effectiveUntilMs (nullable)
accountTierLabel (non-identifying)
isPromotion
verifiedAtMs
verificationMethod
confidence
```

Unknown or expired fee data makes an opportunity ineligible. A promotion is always labeled and results must also be reported without it.

### Inventory model fields

```text
venue
asset
availableQuantity
reservedQuantity
maximumExposure
rebalanceRoute
rebalanceDelayModel
rebalanceCostModel
```

Replay starts from a declared finite inventory snapshot. It may not borrow, teleport, or instantaneously rebalance assets. Results report return on all deployed capital, not just filled notional.

## 9. Bounded storage design

### Journal layout

```text
<data-root>/
  normalized/YYYY-MM-DD/<venue>/<product>/<event-type>-<part>.jsonl
  checkpoints/YYYY-MM-DD/<venue>/<product>/<part>.jsonl
  diagnostic/YYYY-MM-DD/<venue>/<product>/<window-id>.jsonl
  manifests/YYYY-MM-DD/manifest.json
```

Open files use a temporary/open suffix. Rotation closes and fsyncs the part, records its byte count, event count, timestamp bounds, schema version, and checksum in the daily manifest, then hands the closed part to compression. Completed data is immutable.

### Initial bounding policy for review

- capture bounded top-of-book depth, proposed initial depth 20 levels per side;
- checkpoint at least every 60 seconds and after recovery, with the final cadence confirmed from measured delta rates;
- rotate at UTC day boundaries and before any part exceeds a configured byte limit;
- retain enough normalized raw data for the 45–60 day observation target, proposed minimum 75 days;
- retain small derived summaries and manifests longer than raw high-frequency data;
- capture higher-detail diagnostics only around configured candidate/stress windows and cap their total bytes;
- require `maxDataBytes` and `minFreeBytes` in deployment config;
- calculate production values only after a measured growth-rate and VPS capacity audit.

The 2026-08-02 VPS snapshot reported a 75 GB shared root filesystem with 57 GB available. Existing workloads reportedly add approximately 1 GB every 14 days before Stable Corridor collection. The approved approach is to defer a volume purchase and first measure a bounded root-filesystem pilot. Its initial configuration caps collector data at 10 GiB, preserves at least 40 GiB filesystem free space, and records growth after approximately 24, 48, and 72 hours. A dedicated volume is considered only after measured collector growth is projected across the desired retention period.

The collector may delete only expired, manifest-closed files inside its own resolved data root. Before any automated retention deletion is implemented, tests must prove path containment and recovery behavior. At the hard pressure limit, the collector marks health unhealthy and stops collection cleanly; it does not consume space needed by HYPE.

No unbounded raw full-depth retention is permitted.

## 10. Health telemetry

Health is written to a temporary file, flushed as appropriate, and atomically renamed within the same filesystem. Health publication is best-effort but journal failures make the collector unhealthy.

Proposed collector health fields:

```text
schemaVersion
processName
status
reasonCodes[]
commitSha
configHash
startedAtMs
publishedAtMs
eventLoopLagMs
memoryRssBytes
dataRootBytes
diskFreeBytes
journalLastWriteAtMs
journalErrorCount
feeds[]:
  venue
  product
  connectionState
  lastReceivedAtMs
  lastSourceAtMs
  receiveAgeMs
  venueSequence
  gapCount
  reconnectCount
  crossedBookCount
  eligibleForResearch
```

`healthy` means correctness and freshness requirements are satisfied, not merely that the process is alive. Each venue/product has an explicit stale threshold based on expected feed behavior. A missing, malformed, stale, gapped, crossed, or unwritable feed is ineligible.

The later watchdog reads health and alerts. It cannot write collector state, restart a process, or create control files.

## 11. Replay integrity

The replay engine is a deterministic consumer of immutable journals.

Required rules:

- order availability by `receivedTimestampMs` and deterministic ingest order;
- expose no event to a decision before its receive time;
- use source timestamps only for latency and diagnostics;
- snapshot code version, schema version, data-manifest checksums, and configuration hash for every run;
- use a simulated clock; no wall-clock calls inside strategy decisions;
- reject gaps and stale periods or explicitly label the interval ineligible;
- apply fee schedules only within their effective time ranges;
- model tick/lot rules, post-only rejection, cancellation latency, partial fills, asynchronous fills, and price movement during cancel;
- run more than one conservative queue/fill model;
- keep venue-specific finite inventory and delayed/costed rebalance events;
- preserve EUR/USD exposure while EURC inventory is unhedged;
- distinguish displayed opportunity, executable candidate, simulated fill, completed inventory cycle, and net PnL.

### No-look-ahead proof

Tests inject a future event with an extreme price and assert that every prior decision trace and state hash remains unchanged. Replays of the same manifest and configuration must produce byte-identical decisions and summary hashes.

## 12. Test and build gates

### Unit tests

- schema acceptance and rejection;
- decimal canonicalization and precision boundaries;
- timestamp and deterministic ordering;
- venue parser fixtures;
- snapshot/delta reconciliation and sequence gap detection;
- tick/lot metadata;
- stale, crossed-book, and reconnect state transitions;
- atomic health write and malformed previous health recovery;
- journal rotation, checksums, interrupted-tail recovery, and path containment.

### Integration tests

- local fake WebSocket/REST sources only;
- reconnect and resubscribe;
- delayed, duplicated, missing, out-of-order, and malformed messages;
- filesystem full/write error behavior through a controlled test seam;
- bounded memory and journal growth under a fixed synthetic load;
- shutdown flush and restart recovery.

### Replay tests

- no-look-ahead sentinel;
- byte-deterministic rerun;
- gap/stale interval rejection;
- fee schedule boundary;
- finite inventory exhaustion;
- delayed rebalance;
- multiple conservative fill models;
- results measured against total configured capital.

### Static safety gates

- no production dependency or source import from `reverse-copy`;
- no authenticated client, signing, credential, order, withdrawal, or transfer module;
- no `src/execution/`;
- no secret-like fixtures or logs;
- no network dependency in the default test suite.

No adapter is complete with only a happy-path network demonstration; deterministic fixtures and failure behavior are required.

## 13. PM2 and deployment boundaries

### Reserved process names

```text
stable-corridor-collector
stable-corridor-shadow
stable-corridor-watchdog
```

`stable-corridor-live` is not declared.

Stage B deploys only `stable-corridor-collector`. Shadow and watchdog names are reserved but not started until Stage C approval. Each process has:

- `/opt/stable-corridor` as working directory;
- a unique entry point, state/health file, log path, and targeted restart command;
- one instance unless an architecture review proves multi-instance ordering safety;
- an explicit environment/config file;
- no ability to import or access `/opt/bybit-rev`.

Deployment may use the existing `pm2-deploy.service` only with a Stable Corridor-specific build and named process action. Never use `pm2 restart all`. The watchdog is alert-only and cannot invoke PM2. The exact supervisor restart policy must be documented and reviewed before deployment.

## 14. VPS layout

```text
/opt/stable-corridor/                 checked-out code and build
/var/lib/stable-corridor/data/        immutable journals
/var/lib/stable-corridor/state/       health and recoverable process state
/var/lib/stable-corridor/incidents/   bounded incident artifacts
/var/log/stable-corridor/             process logs, if not managed elsewhere
```

Phase 1 needs no exchange secrets and should have no exchange `.env` values. If a later approved phase requires secrets, `/opt/stable-corridor/.env` is separate, mode `0600`, and never shared with HYPE.

Before Stage B deployment:

- inventory filesystem capacity, mounts, ownership, Node.js, PM2, CPU, and memory;
- create a dedicated service identity or document the approved existing identity;
- verify Stable Corridor path permissions do not grant access to HYPE secrets/state;
- set storage caps and alerts from measured data growth;
- document targeted deploy, start, stop, status, log, and rollback commands;
- verify no command rebuilds or restarts `/opt/bybit-rev`.

## 15. Review decisions and remaining gates

The following decisions are either recorded or remain as later gates:

1. Runtime/package manager: Node.js 24 LTS and npm with an exact lockfile; the VPS was upgraded to Node.js 24.18.1 on 2026-08-02.
2. Validation/storage libraries: Zod is the sole production dependency; journal persistence uses Node.js filesystem primitives.
3. Initial adapters: Coinbase A3 and the Binance and Bybit reference slices of A4 are complete; any additional venue adapter requires explicit authorization.
4. Market scope: Priority 0 and the three Binance and three Bybit Priority 1 products are approved; the remaining Priority 1 adapter order remains gated one venue at a time.
5. Book depth/checkpoint cadence: approve the proposed 20 levels and 60-second checkpoints or request a measured pilot first.
6. Storage budget: begin with a 10 GiB bounded pilot and 40 GiB free-space reserve; measure the first 72 hours and add a volume only if the retention projection requires it.
7. Raw frame policy: decide whether bounded raw public frames are retained always, only around errors/dislocations, or not at all.
8. EUR/USD source: select only after license, timing, hours, and cost review.
9. PM2 supervision: resolved for the pilot; collector automatic restart is
   disabled, venue reconnects are internal, and the future watchdog remains
   unable to restart it.
10. Access audit: decide which verified account facts may be committed in sanitized form.

## 16. Stage A acceptance gate

Stage A passes only when:

- this plan and its unresolved decisions are reviewed;
- repository safety instructions and status are accepted;
- normalized envelope and replay ordering are approved;
- market universe and adapter order are approved;
- storage is demonstrably bounded by configuration;
- account-specific fee inputs fail closed when unknown or expired;
- finite inventory is part of the replay contract;
- tests cover gaps, stale data, filesystem failure, and no-look-ahead;
- deployment paths and named PM2 boundaries cannot touch HYPE;
- implementation authorization is explicitly given.

The A1-A5 public-only collector passed locally and its initial bounded Stage
B VPS collection remained healthy beyond 72 hours. The next gate is the
final immutable pull and audit, followed by an explicit retention or fresh
window decision. Conventional FX, shadow research, and all execution work
remain separately gated.
