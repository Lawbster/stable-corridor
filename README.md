# Stable Corridor

Research repository for evaluating dislocation-only, post-only EURC/USDC market making with pre-positioned, finite inventory and multi-venue fair value.

No trading bot exists. No capital, API keys, authenticated exchange access, or live execution is authorized.

## Current phase

The bounded Stage B public collector completed its initial 72-hour
validation window and remains deployed.
Coinbase, Binance, Bybit, and Kraken adapters collect only unauthenticated
public metadata, L2 books, trades, and health inputs. The runner writes one
globally ordered deterministic journal, publishes atomic health, creates
60-second book checkpoints, reconnects failed venue sessions, and stops on
journal, health, or storage failure.

A conventional FX adapter, shadow decisions, and execution remain
unimplemented. No authenticated client or trading path exists.

The initial and free cross-regime checkpoint/trade-through screens now
classify the current Coinbase maker corridor as an economic no-go. Their
methods and interpretation are in
`research/initial-edge-screen-2026-08-06.md` and
`research/free-history-edge-screen-2026-08-06.md`.

A separate opt-in experiment collects quote-only native Solana `EURC/USDC`
routes from Jupiter at 1,000 and 10,000 units. Its first 9.47-hour screen
found no gross 1 bp observation; a bounded response/reconnect repair is ready
for one clean 24-hour confirmation. It joins quotes to contemporaneous
Coinbase depth in offline replay and has no wallet, transaction, or execution
path.

## Repository map

```text
config/                 Reviewed example configuration
src/collector/          Public-only collection pipeline
src/venues/             CEX public adapters and optional Jupiter quote adapter
src/fair-value/         Future fair-value derivation
src/opportunity/        Future shadow opportunity policy
src/replay/             Deterministic no-look-ahead replay
src/inventory/          Finite simulated inventory
src/risk/               Research and future runtime safety rules
src/health/             Atomic health telemetry
scripts/                Named development and deployment helpers
research/               Plans, access audit, and findings
backtests/               Generated summaries and reproducible manifests
docs/operations/        Deployment and operational boundaries
tests/                  Deterministic fixtures and offline test suites
```

There is intentionally no `src/execution/`.

## Start here

1. Read `AGENTS.md`.
2. Read `PROJECT_STATUS.md`.
3. Review the Stage A collector implementation plan.
4. Review the Coinbase public API contract.
5. Review the Binance public API contract.
6. Review the Bybit public API contract.
7. Review the Kraken public API contract.
8. Review the bounded collector pilot runbook.
9. Review the Jupiter public quote contract and experiment runbook.
10. Record only non-sensitive account findings in `research/access-audit.md`.

The economic thesis and full project boundaries are in
`stable-corridor-new-repo-onboarding-brief-2026-08-01.md`.

The verified endpoint, message, normalization, and fail-closed rules for A3 are in
`research/coinbase-public-api-contract.md`.

The equivalent A4 Binance rules are in
`research/binance-public-api-contract.md`.

The equivalent A4 Bybit rules are in
`research/bybit-public-api-contract.md`.

The equivalent A4 Kraken rules are in
`research/kraken-public-api-contract.md`.

The quote-only Solana experiment boundary is in
`research/jupiter-public-api-contract.md`; deployment and analysis are in
`docs/operations/jupiter-shadow.md`.

The install, named PM2 operations, rollback, and 72-hour measurement steps
are in `docs/operations/collector-pilot.md`.

The pull-only WSL runtime mirror is documented in
`docs/operations/local-rsync.md`.

Verified compression and the manual, checksum-gated source-reclamation
workflow for immutable closed journals are documented in
`docs/operations/journal-compression.md`.

## Development gates

The project targets the Node.js 24 LTS line.

```text
npm ci
npm run check
```

Individual offline gates:

```text
npm run format:check
npm run lint
npm run test:unit
npm run test:integration
npm run test:replay
npm run build
```

The default tests require no credentials or network access.

Free first-of-month historical samples can broaden the economic screen
without an API key or paid subscription:

```text
npm run build
npm run history:free -- \
  --cache-root ./historical-cache \
  --data-root ./historical-data \
  --from-month 2024-09 \
  --to-month 2026-08
```

The importer is restricted to the five public datasets used by the
current corridor and rejects non-first-of-month dates. See
`docs/operations/free-historical-data.md` for integrity checks, analysis
commands, and vendor-timestamp limitations.

After building, reproduce the initial receive-time checkpoint screen:

```text
npm run analyze:checkpoints -- \
  --data-root <verified-data-root> \
  --output <report-path> \
  --run-id <collector-run-id>
```

The focused maker trade-through screen uses the same verified archive:

```text
npm run analyze:trade-through -- \
  --data-root <verified-data-root> \
  --output <report-path> \
  --run-id <collector-run-id>
```

The opt-in Coinbase/Jupiter public quote screen uses the collector run created
after Jupiter is enabled:

```text
npm run analyze:cex-dex -- \
  --data-root <verified-data-root> \
  --output <report-path> \
  --run-id <collector-run-id>
```
