# Project Status

- Current phase: original maker thesis is a no-go; bounded Coinbase/Jupiter public-quote experiment implemented but not yet deployed
- Live execution: nonexistent and unauthorized
- Deployed commit: `7533605`; all 13 public feeds healthy with zero gaps, reconnects, or journal errors at the first post-deployment observation
- PM2 processes: `stable-corridor-collector` online with automatic restart disabled; no shadow, watchdog, or live process
- Current finding: occasional 5+ bp dislocations exist, but 24 free sampled days produced only nine 1,000 EURC proxy fills and approximately 0.15 USDC/day gross mark-to-fair; the current Coinbase maker corridor is an economic no-go
- Implemented artifact: bounded unauthenticated four-venue collector, optional quote-only Jupiter EURC/USDC probe, verified gzip-only retention, unified streaming replay, guarded no-auth free-history import, and reproducible CEX/CEX and CEX/DEX screens
- Runtime artifact: one explicitly named PM2 process with a pinned Node 24 interpreter, isolated paths, commit stamping, no credentials, and automatic restart disabled
- Verification: the post-reclamation VPS audit passed 600 of 600 gzip-only parts; the free historical archive independently passed 120 of 120 parts, 13,424,304 events, and 11,267,466,985 logical bytes; repository checks cover source/gzip equivalence, external normalization, replay ordering, checkpoint screening, and trade-through behavior
- Storage decision: the reviewed plan reclaimed 6,776,183,693 VPS source bytes while retaining 375,093,132 verified gzip bytes and the local source mirror
- Data-quality decision: Coinbase `sequence_num`, not adjacent numeric `trade_id`, is the documented delivery boundary; the corrected adapter preserves non-adjacent forward trades and journals structured continuity evidence
- Runtime decision: the VPS runs Node.js 24.18.1 and existing workloads remain isolated
- Next gate: deploy the optional four-probe Jupiter feed, collect at least 24 hours and preferably seven days, then apply the modeled 3 bp and sampled two-second persistence stop rule
- Operator task: enable only the reviewed public Jupiter block and continue pull-only mirroring; do not connect a wallet, fund an experiment, purchase data, or build execution
