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

## Repository map

```text
config/                 Reviewed example configuration
src/collector/          Public-only collection pipeline
src/venues/             Coinbase, Binance, Bybit, and Kraken public adapters
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
9. Record only non-sensitive account findings in `research/access-audit.md`.

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
