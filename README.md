# Stable Corridor

Research repository for evaluating dislocation-only, post-only EURC/USDC market making with pre-positioned, finite inventory and multi-venue fair value.

No trading bot exists. No capital, API keys, authenticated exchange access, or live execution is authorized.

## Current phase

Stage A A1/A2/A3: the reviewed local foundation and first public adapter are implemented. The Coinbase adapter collects unauthenticated metadata, L2 book, trade, status, and heartbeat data for `EURC-USDC` and `USDC-EUR`, normalizes it into the deterministic journal contract, and fails closed on continuity or health violations.

Additional venue adapters, long-running collection, deployment, shadow decisions, and execution remain unimplemented.

## Repository map

```text
config/                 Reviewed example configuration
src/collector/          Public-only collection pipeline
src/venues/             Coinbase public adapter; future reference adapters
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
5. Record only non-sensitive account findings in `research/access-audit.md`.

The economic thesis and full project boundaries are in
`stable-corridor-new-repo-onboarding-brief-2026-08-01.md`.

The verified endpoint, message, normalization, and fail-closed rules for A3 are in
`research/coinbase-public-api-contract.md`.

## Development gates

The project targets the Node.js 24 LTS line.

```text
npm install
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
