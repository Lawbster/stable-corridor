# Project Status

- Current phase: Stage A — foundation, A3 Coinbase, and the A4 Binance and Bybit public reference adapters complete locally
- Live execution: nonexistent and unauthorized
- Deployed commit: not deployed
- PM2 processes: none
- Current finding: Coinbase remains the candidate execution venue; Binance and Kraken are reference/backup rails at the observed account tiers because their relevant maker fees are 10 bp and 20 bp respectively
- Implemented artifact: deterministic schema/journal/health foundation plus bounded, unauthenticated Coinbase, Binance, and Bybit public adapters; Bybit covers `USDTEUR`, `USDCEUR`, and `USDCUSDT` with public metadata, 200-level snapshot/delta books, trades, application heartbeat, per-product continuity, and fail-closed health
- Verification: `npm run check` passes 123 tests across 25 files; the complete npm dependency audit reports 0 vulnerabilities
- Storage decision: run only a bounded 10 GiB pilot with a 40 GiB free-space reserve, measure the first 72 hours, and add a volume only if measured retention needs justify it
- Runtime decision: the VPS was upgraded to Node.js 24.18.1 and existing workloads were confirmed healthy
- Next gate: review and explicitly authorize either the A4 Kraken public reference adapter or bounded forward-collection readiness; long-running collection and deployment remain separate decisions
- Operator task: confirm Kraken USDC/Solana deposit support if considering that route and record Bybit EUR-rail terms when naturally used
