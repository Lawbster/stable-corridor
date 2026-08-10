# Project Status

- Current phase: original maker thesis remains a no-go; the repaired Coinbase/Jupiter run completed a final 88.82-hour screen and the broad collection gate is closed
- Live execution: nonexistent and unauthorized
- Deployed commit: `92d3b42`; all 14 public feeds were healthy after the bounded Jupiter response/reconnect repair
- PM2 processes: `stable-corridor-collector` is stopped cleanly; automatic restart is disabled and no shadow, watchdog, or live process exists
- Current finding: 152,102 repaired-run comparisons produced eight modeled 3+ bp public quotes across six episodes, none confirmed at the next same-route quote; two extreme August 10 clusters were non-guaranteed aggregator responses and justify only bounded requote/transaction-feasibility research
- Implemented artifact: bounded unauthenticated four-venue collector, optional quote-only Jupiter EURC/USDC probe, verified gzip-only retention, unified streaming replay, guarded no-auth free-history import, and reproducible CEX/CEX and CEX/DEX screens
- Runtime artifact: one explicitly named PM2 process with a pinned Node 24 interpreter, isolated paths, commit stamping, no credentials, and automatic restart disabled
- Verification: the final local audit passed 1,193 of 1,193 immutable parts, 26,948,264 events, and 16,785,963,093 logical bytes; the repaired run contains 12,143,072 contiguous events, no duplicates, no open journals, both manifests, and zero journal errors
- Storage decision: the reviewed plan reclaimed 6,776,183,693 VPS source bytes while retaining 375,093,132 verified gzip bytes and the local source mirror
- Data-quality decision: Coinbase `sequence_num`, not adjacent numeric `trade_id`, is the documented delivery boundary; the corrected adapter preserves non-adjacent forward trades and journals structured continuity evidence
- Runtime decision: the VPS runs Node.js 24.18.1 and existing workloads remain isolated
- Next gate: archive the VPS source safely, then decide whether the six anomaly episodes justify a bounded immediate-requote and unsigned transaction-construction probe
- Operator task: compress the stopped run on the VPS, generate and review a reclamation plan, and delete source journals only after the guarded plan matches the locally verified archive
