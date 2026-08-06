# Free Historical Data

## Purpose

This workflow broadens the economic screen without waiting for the live
collector and without purchasing data. It downloads only the free
first-of-month Tardis datasets needed for the current corridor:

- Coinbase `EURC-USDC` top-five book snapshots and trades;
- Binance `EURUSDC` top-five book snapshots;
- Bybit Spot `USDCEUR` top-five book snapshots;
- Kraken `USDC/EUR` top-five book snapshots.

The importer does not use an API key, account credential, authenticated
exchange endpoint, or order path. It rejects any requested date that is
not the first day of a month.

Vendor data is complementary to the live collector. Its local timestamps
describe arrival at the vendor's infrastructure, not at the Stable
Corridor VPS. It can screen market structure and public trade-through,
but it cannot establish our production latency or venue connectivity.

## Build and import

From the repository root:

```text
npm run build

npm run history:free -- \
  --cache-root ./historical-cache \
  --data-root ./historical-data \
  --from-month 2024-09 \
  --to-month 2026-08
```

The raw gzip cache and normalized archive are ignored by Git. The
normalized archive is gzip-only and includes the same source and
compression integrity metadata used by the live journal archive. A
successful command prints its deterministic collector run ID.

Each response is bounded to 100 MB by default and must match the vendor's
advertised byte count and MD5. Existing cache files are rehashed before
reuse. Incomplete or mismatched cache entries fail closed.

## Verify

```text
npm run audit:data -- \
  --data-root ./historical-data \
  --output ./state/tardis-dataset-audit.json \
  --compression none
```

The audit must report `Integrity=passed`. Do not analyze an archive with
an integrity failure.

## Analyze

Use the run ID printed by the import:

```text
npm run analyze:checkpoints -- \
  --data-root ./historical-data \
  --output ./state/tardis-checkpoint-screen.json \
  --run-id <printed-run-id> \
  --target-sample-interval-ms 60000

npm run analyze:trade-through -- \
  --data-root ./historical-data \
  --output ./state/tardis-trade-through-screen.json \
  --run-id <printed-run-id> \
  --target-sample-interval-ms 60000
```

The one-minute target interval makes the checkpoint screen comparable to
the live collector's checkpoint cadence while retaining tick-level
reference updates and Coinbase trades. The dates are intentionally
discontinuous. Per-day rates therefore use the sum of observed daily
spans, not the calendar time between the first and last sampled month.

## Boundaries

- Historical trade-through remains a fill proxy, not a fill report.
- Vendor top-five snapshots do not preserve individual-order priority.
- Vendor collection location and disconnects differ from the VPS.
- No imported result authorizes authenticated clients or execution.
- If the free cross-regime sample remains economically marginal, do not
  purchase more data merely to continue the project.
