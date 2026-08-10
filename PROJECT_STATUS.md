# Project Status

- Current phase: broad CEX and passive Coinbase/Jupiter collection are closed; one bounded public-only Coinbase/Jupiter anomaly-persistence probe is approved and implemented locally for deployment review
- Live execution: nonexistent and unauthorized; no wallet, taker, transaction construction, signing, API key, order, transfer, or withdrawal path exists
- Deployed commit: `b383b65`; `stable-corridor-collector` is stopped cleanly with PM2 automatic restart disabled
- Current finding: 152,102 repaired-run comparisons produced eight modeled 3+ bp quotes across six episodes, none confirmed at the next same-route observation approximately 8.4 seconds later
- Approved feed set: continuous Coinbase `EURC-USDC` and Jupiter `EURC-USDC` only; Binance, Bybit, Kraken, and Coinbase `USDC-EUR` remain available offline but are disabled in the probe configuration
- Probe gate: an eligible 3 bp baseline quote journals a `cex_dex_probe` decision and schedules exactly three public same-route requotes at approximately 2.1, 4.2, and 6.3 seconds without recursive triggering
- Verification: the final VPS audit passed 1,193 of 1,193 immutable gzip-only parts, 26,948,264 events, and 16,785,963,093 logical bytes with zero source-present journals
- Storage decision: two reviewed passes reclaimed all 16,785,963,093 VPS source bytes while retaining 925,973,212 verified gzip bytes; future daily compression may be automated, but source reclamation remains manual and checksum-gated
- Runtime boundary: one named PM2 collector, optional user-level compression timer, pinned Node.js 24.18.1, isolated paths, no automatic PM2 restart, and no changes to the HYPE system
- Stop rule: run no more than seven days and stop early after five completed probes if none remains above 3 bp at the first follow-up
- Pass rule: only two independent first-follow-up confirmations may justify a separate review of unsigned transaction construction; public requotes alone do not establish profitability or landing
- Operator task: deploy the reviewed repository head, replace the host-local config with the narrowed two-feed config after diff review, install and test the compression timer, and verify exactly two healthy feeds
