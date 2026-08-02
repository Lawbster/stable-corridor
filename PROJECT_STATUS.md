# Project Status

- Current phase: Stage A — A1/A2 foundation and A3 Coinbase public adapter complete locally
- Live execution: nonexistent and unauthorized
- Deployed commit: not deployed
- PM2 processes: none
- Current finding: Coinbase remains the candidate execution venue; Binance and Kraken are reference/backup rails at the observed account tiers because their relevant maker fees are 10 bp and 20 bp respectively
- Implemented artifact: deterministic schema/journal/health foundation plus a bounded, unauthenticated Coinbase Advanced public adapter for `EURC-USDC` and `USDC-EUR`, with metadata, L2 book, trade, status, heartbeat, continuity, and fail-closed health handling
- Verification: `npm run check` passes 75 tests across 13 files; the complete npm dependency audit reports 0 vulnerabilities
- Storage decision: run only a bounded 10 GiB pilot with a 40 GiB free-space reserve, measure the first 72 hours, and add a volume only if measured retention needs justify it
- Runtime decision: the VPS was upgraded to Node.js 24.18.1 and existing workloads were confirmed healthy
- Next gate: review A3 and explicitly authorize A4, starting with a Binance public reference adapter; long-running collection and deployment remain separate later decisions
- Operator task: inspect Bybit access/fees, record Coinbase SEPA fee/timing when next naturally used, and confirm Kraken USDC/Solana deposit support if considering that route
