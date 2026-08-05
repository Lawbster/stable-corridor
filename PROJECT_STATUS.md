# Project Status

- Current phase: Stage B 72-hour collection gate complete; corrected continuity window collecting
- Live execution: nonexistent and unauthorized
- Deployed commit: `7533605`; all 13 public feeds healthy with zero gaps, reconnects, or journal errors at the first post-deployment observation
- PM2 processes: `stable-corridor-collector` online with automatic restart disabled; no shadow, watchdog, or live process
- Current finding: no edge is proven; Coinbase remains the candidate execution venue, while Binance and Kraken remain reference/backup rails at the observed account tiers
- Implemented artifact: bounded unauthenticated four-venue collector with deterministic journals, run manifests, atomic health, reconnects, verified non-destructive closed-journal compression, and a compression-aware local audit
- Runtime artifact: one explicitly named PM2 process with a pinned Node 24 interpreter, isolated paths, commit stamping, no credentials, and automatic restart disabled
- Verification: `npm run check` passes 177 tests across 40 files; the final 78.21-hour mirror audit verified 600 of 600 closed parts, 11,176,976 events, and 6,776,183,693 logical bytes with zero integrity or ingest-sequence failures
- Storage decision: preserve the finalized pilot locally and keep the corrected run logically separate by run ID; do not wipe yet; approximately 3.68 GiB remains under the 10 GiB ceiling, so the next operation is a one-part source-preserving compression trial
- Data-quality decision: Coinbase `sequence_num`, not adjacent numeric `trade_id`, is the documented delivery boundary; the corrected adapter preserves non-adjacent forward trades and journals structured continuity evidence
- Runtime decision: the VPS runs Node.js 24.18.1 and existing workloads remain isolated
- Next gate: observe the corrected Coinbase continuity evidence through at least one closed journal boundary and test one verified compressed part at low priority before any retention deletion is considered
- Operator task: continue pull-only mirroring; do not prune or wipe the verified pilot until compressed retention has passed its bounded VPS and local audit checks
