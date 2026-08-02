# Project Status

- Current phase: Stage A — foundation, A3 Coinbase, and the A4 Binance public reference adapter complete locally
- Live execution: nonexistent and unauthorized
- Deployed commit: not deployed
- PM2 processes: none
- Current finding: Coinbase remains the candidate execution venue; Binance and Kraken are reference/backup rails at the observed account tiers because their relevant maker fees are 10 bp and 20 bp respectively
- Implemented artifact: deterministic schema/journal/health foundation plus bounded, unauthenticated Coinbase and Binance public adapters; Binance covers `EURUSDC`, `EURIUSDC`, and `USDCUSD` with REST/stream book synchronization, metadata, trades, per-product continuity, and fail-closed health
- Verification: `npm run check` passes 99 tests across 19 files; the complete npm dependency audit reports 0 vulnerabilities
- Storage decision: run only a bounded 10 GiB pilot with a 40 GiB free-space reserve, measure the first 72 hours, and add a volume only if measured retention needs justify it
- Runtime decision: the VPS was upgraded to Node.js 24.18.1 and existing workloads were confirmed healthy
- Next gate: review the Binance slice and explicitly authorize the next A4 reference adapter, Bybit; long-running collection and deployment remain separate later decisions
- Operator task: record Bybit minimum orders for `USDTEUR`, `USDCEUR`, and `USDCUSDT`, record Coinbase SEPA fee/timing when next naturally used, and confirm Kraken USDC/Solana deposit support if considering that route
