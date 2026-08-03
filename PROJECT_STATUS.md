# Project Status

- Current phase: Stage B VPS deployment validation
- Live execution: nonexistent and unauthorized
- Deployed commit: `0e6f419`; five-minute Binance/Bybit silence bounds loaded and healthy four-venue ingestion verified
- PM2 processes: `stable-corridor-collector` online with one intentional deployment restart and automatic restart disabled; no shadow, watchdog, or live process
- Current finding: Coinbase remains the candidate execution venue; Binance and Kraken are reference/backup rails at the observed account tiers because their relevant maker fees are 10 bp and 20 bp respectively
- Implemented artifact: deterministic schema/journal/health foundation; bounded unauthenticated Coinbase, Binance, Bybit, and Kraken adapters; and one public-only runner with global ingest ordering, 60-second checkpoints, atomic health, reconnects, and fail-closed storage/journal handling
- Runtime artifact: one explicitly named PM2 process with a pinned absolute Node 24 interpreter, isolated paths, commit stamping, no credentials, and automatic restart disabled for the pilot
- Verification: `npm run check` passes 162 tests across 37 files; dependency audit reports 0 vulnerabilities; the 20-hour VPS sample reports all 13 feeds healthy, empty reason codes, zero journal errors, and zero event-loop lag
- Storage decision: current uncompressed growth is approximately 1.81 GiB/day; continue only to the bounded 72-hour gate under the 10 GiB ceiling and 40 GiB reserve, then test compression before sizing a volume
- Runtime decision: the VPS was upgraded to Node.js 24.18.1 and existing workloads were confirmed healthy
- Next gate: verify reconnect reduction and complete the remaining 48/72-hour storage and resource measurements
- Operator task: use the pull-only WSL mirror in `docs/operations/local-rsync.md`; separately confirm Kraken USDC/Solana deposit support only if considering that rebalance route
