# Project Status

- Current phase: Stage B 72-hour collection gate complete; corrected continuity window collecting
- Live execution: nonexistent and unauthorized
- Deployed commit: `7533605`; all 13 public feeds healthy with zero gaps, reconnects, or journal errors at the first post-deployment observation
- PM2 processes: `stable-corridor-collector` online with automatic restart disabled; no shadow, watchdog, or live process
- Current finding: no edge is proven; Coinbase remains the candidate execution venue, while Binance and Kraken remain reference/backup rails at the observed account tiers
- Implemented artifact: bounded unauthenticated four-venue collector with deterministic journals, run manifests, atomic health, reconnects, verified closed-journal compression, a compression-aware local audit, and checksum-gated source-reclamation planning
- Runtime artifact: one explicitly named PM2 process with a pinned Node 24 interpreter, isolated paths, commit stamping, no credentials, and automatic restart disabled
- Verification: `npm run check` passes 185 tests across 41 files; the final 78.21-hour mirror audit verified 600 of 600 closed parts, 11,176,976 events, and 6,776,183,693 logical bytes with zero integrity or ingest-sequence failures
- Storage decision: all 600 finalized pilot parts have verified gzip copies totaling 375,093,132 bytes, a 5.5355% ratio; the local mirror retains both forms and no VPS source has yet been reclaimed
- Data-quality decision: Coinbase `sequence_num`, not adjacent numeric `trade_id`, is the documented delivery boundary; the corrected adapter preserves non-adjacent forward trades and journals structured continuity evidence
- Runtime decision: the VPS runs Node.js 24.18.1 and existing workloads remain isolated
- Next gate: generate and review a full checksum-bound VPS reclamation plan, while continuing to observe corrected Coinbase continuity through a closed journal boundary; applying the plan remains a separate destructive approval
- Operator task: continue pull-only mirroring; run only the reclamation planning mode after deployment and do not supply the apply checksum until the plan and retained local audit have been reviewed
