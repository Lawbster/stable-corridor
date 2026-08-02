# Project Status

- Current phase: Stage B bounded public collector is install-ready locally
- Live execution: nonexistent and unauthorized
- Deployed commit: not deployed
- PM2 processes: none
- Current finding: Coinbase remains the candidate execution venue; Binance and Kraken are reference/backup rails at the observed account tiers because their relevant maker fees are 10 bp and 20 bp respectively
- Implemented artifact: deterministic schema/journal/health foundation; bounded unauthenticated Coinbase, Binance, Bybit, and Kraken adapters; and one public-only runner with global ingest ordering, 60-second checkpoints, atomic health, reconnects, and fail-closed storage/journal handling
- Runtime artifact: one explicitly named PM2 process with a pinned absolute Node 24 interpreter, isolated paths, commit stamping, no credentials, and automatic restart disabled for the pilot
- Verification: `npm run check` passes 160 tests across 36 files; dependency audit reports 0 vulnerabilities; a public-network durability smoke reached healthy on all 13 configured feeds with zero journal errors while syncing every append
- Storage decision: run only a bounded 10 GiB pilot with a 40 GiB free-space reserve, measure the first 72 hours, and add a volume only if measured retention needs justify it
- Runtime decision: the VPS was upgraded to Node.js 24.18.1 and existing workloads were confirmed healthy
- Next gate: operator installs only `stable-corridor-collector`, verifies fresh healthy output, and records data growth and resource use at approximately 24, 48, and 72 hours
- Operator task: follow `docs/operations/collector-pilot.md`; separately confirm Kraken USDC/Solana deposit support only if considering that rebalance route
