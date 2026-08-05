# Project Status

- Current phase: Stage B collection validated; initial economic screening complete; focused episode replay next
- Live execution: nonexistent and unauthorized
- Deployed commit: `7533605`; all 13 public feeds healthy with zero gaps, reconnects, or journal errors at the first post-deployment observation
- PM2 processes: `stable-corridor-collector` online with automatic restart disabled; no shadow, watchdog, or live process
- Current finding: no edge is proven; the first 56.1-hour screen classifies gross margins as thin, with a 1.73 bp P95 absolute dislocation, no high-confidence 5 bp checkpoint, and limited queue clearance
- Implemented artifact: bounded unauthenticated four-venue collector, verified gzip-only retention, unified streaming replay input, and reproducible checkpoint and maker trade-through screens
- Runtime artifact: one explicitly named PM2 process with a pinned Node 24 interpreter, isolated paths, commit stamping, no credentials, and automatic restart disabled
- Verification: the post-reclamation VPS audit passed 600 of 600 gzip-only parts with zero failures; the local mirror retains both representations; repository checks cover source/gzip equivalence, replay ordering, checkpoint screening, and trade-through behavior
- Storage decision: the reviewed plan reclaimed 6,776,183,693 VPS source bytes while retaining 375,093,132 verified gzip bytes and the local source mirror
- Data-quality decision: Coinbase `sequence_num`, not adjacent numeric `trade_id`, is the documented delivery boundary; the corrected adapter preserves non-adjacent forward trades and journals structured continuity evidence
- Runtime decision: the VPS runs Node.js 24.18.1 and existing workloads remain isolated
- Next gate: full-resolution replay only around the 62 observed 2+ bp episodes, including queue changes, post-fill markouts, exits, finite inventory, and explicit costs
- Operator task: continue collection and pull-only mirroring; do not fund accounts or build execution while the focused replay tests whether the thin gross observations survive realistic costs
