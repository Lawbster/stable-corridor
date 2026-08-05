# Project Status

- Current phase: Stage B 72-hour collection gate complete; final immutable pull and retention decision pending
- Live execution: nonexistent and unauthorized
- Deployed commit: `ce49281`; all 13 public feeds healthy at the latest observation
- PM2 processes: `stable-corridor-collector` online with automatic restart disabled; no shadow, watchdog, or live process
- Current finding: no edge is proven; Coinbase remains the candidate execution venue, while Binance and Kraken remain reference/backup rails at the observed account tiers
- Implemented artifact: bounded unauthenticated four-venue collector with deterministic journals, run manifests, atomic health, reconnects, verified non-destructive closed-journal compression, and a compression-aware local audit
- Runtime artifact: one explicitly named PM2 process with a pinned Node 24 interpreter, isolated paths, commit stamping, no credentials, and automatic restart disabled
- Verification: `npm run check` passes 177 tests across 40 files; the 77.3-hour mirror audit verified 519 of 519 closed parts, 7,641,004 events, and 4,638,773,335 logical bytes with zero integrity failures; runtime health reported zero journal errors, 1 ms event-loop lag, and approximately 228 MiB RSS
- Storage decision: measured growth is approximately 1.94 GiB/day uncompressed; gzip level 6 measured a 5.5557% ratio, so a verified source-preserving compressor is ready for a one-part operational trial
- Data-quality decision: Coinbase `sequence_num`, not adjacent numeric `trade_id`, is the documented delivery boundary; the corrected adapter preserves non-adjacent forward trades and journals structured continuity evidence
- Runtime decision: the VPS runs Node.js 24.18.1 and existing workloads remain isolated
- Next gate: deploy the Coinbase correction, close and pull the existing run, audit the full immutable dataset, then choose retention or a fresh collection window without deleting evidence prematurely
- Operator task: use the pull-only WSL mirror in `docs/operations/local-rsync.md`; do not prune journals before the final pull and audit
