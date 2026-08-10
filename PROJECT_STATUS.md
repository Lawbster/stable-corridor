# Project Status

- Current phase: original maker thesis remains a no-go; the repaired Coinbase/Jupiter confirmation completed a 72.49-hour immutable-prefix screen and the broad collection gate is complete
- Live execution: nonexistent and unauthorized
- Deployed commit: `92d3b42`; all 14 public feeds were healthy after the bounded Jupiter response/reconnect repair
- PM2 processes: one `stable-corridor-collector` process online; automatic restart is disabled and no shadow, watchdog, or live process exists
- Current finding: 124,149 repaired-run comparisons produced four isolated modeled 3+ bp public quotes, all at size 1,000 and none confirmed at the next same-route quote; this rejects a recurring broad corridor but preserves a narrow anomaly worth optional trigger/requote research
- Implemented artifact: bounded unauthenticated four-venue collector, optional quote-only Jupiter EURC/USDC probe, verified gzip-only retention, unified streaming replay, guarded no-auth free-history import, and reproducible CEX/CEX and CEX/DEX screens
- Runtime artifact: one explicitly named PM2 process with a pinned Node 24 interpreter, isolated paths, commit stamping, no credentials, and automatic restart disabled
- Verification: the latest local audit passed 1,108 of 1,108 immutable parts, 24,586,536 events, and 15,301,562,977 logical bytes; the active repaired run contributes a 9,781,344-event closed prefix while current-day open journals remain excluded
- Storage decision: the reviewed plan reclaimed 6,776,183,693 VPS source bytes while retaining 375,093,132 verified gzip bytes and the local source mirror
- Data-quality decision: Coinbase `sequence_num`, not adjacent numeric `trade_id`, is the documented delivery boundary; the corrected adapter preserves non-adjacent forward trades and journals structured continuity evidence
- Runtime decision: the VPS runs Node.js 24.18.1 and existing workloads remain isolated
- Next gate: stop and finalize the broad collector, perform one final pull and audit, then decide whether to build a bounded 1,000-size trigger/requote probe around the four isolated anomalies
- Operator task: stop only `stable-corridor-collector` soon because its data root is approximately 10.11 GB against the configured 10 GiB ceiling; preserve the final source journals locally before VPS compression/reclamation
