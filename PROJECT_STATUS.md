# Project Status

- Current phase: Stage B VPS deployment validation
- Live execution: nonexistent and unauthorized
- Deployed commit: `944c66c`; healthy four-venue ingestion verified, final quiet-Kraken threshold tuning pending
- PM2 processes: `stable-corridor-collector` online with zero PM2 restarts and automatic restart disabled; no shadow, watchdog, or live process
- Current finding: Coinbase remains the candidate execution venue; Binance and Kraken are reference/backup rails at the observed account tiers because their relevant maker fees are 10 bp and 20 bp respectively
- Implemented artifact: deterministic schema/journal/health foundation; bounded unauthenticated Coinbase, Binance, Bybit, and Kraken adapters; and one public-only runner with global ingest ordering, 60-second checkpoints, atomic health, reconnects, and fail-closed storage/journal handling
- Runtime artifact: one explicitly named PM2 process with a pinned absolute Node 24 interpreter, isolated paths, commit stamping, no credentials, and automatic restart disabled for the pilot
- Verification: `npm run check` passes 162 tests across 37 files; dependency audit reports 0 vulnerabilities; corrected VPS run reports all 13 feeds healthy, empty reason codes, zero journal errors, and successful targeted Kraken recoveries
- Storage decision: run only a bounded 10 GiB pilot with a 40 GiB free-space reserve, measure the first 72 hours, and add a volume only if measured retention needs justify it
- Runtime decision: the VPS was upgraded to Node.js 24.18.1 and existing workloads were confirmed healthy
- Next gate: deploy the five-minute quiet-Kraken threshold, verify stable health, then begin the 24/48/72-hour measurement window
- Operator task: follow `docs/operations/collector-pilot.md`; separately confirm Kraken USDC/Solana deposit support only if considering that rebalance route
