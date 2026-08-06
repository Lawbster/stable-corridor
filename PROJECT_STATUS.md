# Project Status

- Current phase: original maker thesis is a no-go; the first Coinbase/Jupiter run is now immutable and found no notable edge, while one repaired 24-hour confirmation is collecting
- Live execution: nonexistent and unauthorized
- Deployed commit: `92d3b42`; all 14 public feeds were healthy after the bounded Jupiter response/reconnect repair
- PM2 processes: one `stable-corridor-collector` process online; automatic restart is disabled and no shadow, watchdog, or live process exists
- Current finding: the maker corridor remains a no-go; the formal immutable 9.47-hour Jupiter screen produced 14,529 eligible comparisons, no gross 1 bp observation, and no non-negative modeled result
- Implemented artifact: bounded unauthenticated four-venue collector, optional quote-only Jupiter EURC/USDC probe, verified gzip-only retention, unified streaming replay, guarded no-auth free-history import, and reproducible CEX/CEX and CEX/DEX screens
- Runtime artifact: one explicitly named PM2 process with a pinned Node 24 interpreter, isolated paths, commit stamping, no credentials, and automatic restart disabled
- Verification: the latest local audit passed 836 of 836 immutable parts, 14,805,192 events, and 9,026,940,712 logical bytes; the finalized Jupiter run has 2,304,010 contiguous events and both manifests; the separate free historical archive passed 120 of 120 parts
- Storage decision: the reviewed plan reclaimed 6,776,183,693 VPS source bytes while retaining 375,093,132 verified gzip bytes and the local source mirror
- Data-quality decision: Coinbase `sequence_num`, not adjacent numeric `trade_id`, is the documented delivery boundary; the corrected adapter preserves non-adjacent forward trades and journals structured continuity evidence
- Runtime decision: the VPS runs Node.js 24.18.1 and existing workloads remain isolated
- Next gate: finish one clean 24-hour repaired confirmation and stop this route if no gross 1 bp observation appears
- Operator task: leave the named collector uninterrupted until the confirmation gate, then pull, audit, and run the immutable CEX/DEX screen; do not connect a wallet, fund an experiment, purchase data, or build execution
