# Project Status

- Current phase: original maker thesis is a no-go; first Coinbase/Jupiter run found no notable edge and exposed three bounded collection defects now repaired locally
- Live execution: nonexistent and unauthorized
- Deployed commit: `75fb534`; 13 CEX feeds remain healthy and journal-safe, while Jupiter is stopped by the diagnosed reconnect defect until the repair is deployed
- PM2 processes: `stable-corridor-collector` online but health-degraded by the stopped Jupiter feed; automatic restart is disabled and no shadow, watchdog, or live process exists
- Current finding: the maker corridor remains a no-go; the provisional 9.47-hour Jupiter screen produced 14,529 eligible comparisons, no gross 1 bp observation, and no non-negative modeled result
- Implemented artifact: bounded unauthenticated four-venue collector, optional quote-only Jupiter EURC/USDC probe, verified gzip-only retention, unified streaming replay, guarded no-auth free-history import, and reproducible CEX/CEX and CEX/DEX screens
- Runtime artifact: one explicitly named PM2 process with a pinned Node 24 interpreter, isolated paths, commit stamping, no credentials, and automatic restart disabled
- Verification: the latest local audit passed 754 of 754 immutable parts, 12,501,182 events, and 7,594,963,268 logical bytes; the separate free historical archive passed 120 of 120 parts; repository checks now cover observed Jupiter scientific decimals, fractional split routes, and stale reconnect lifecycle
- Storage decision: the reviewed plan reclaimed 6,776,183,693 VPS source bytes while retaining 375,093,132 verified gzip bytes and the local source mirror
- Data-quality decision: Coinbase `sequence_num`, not adjacent numeric `trade_id`, is the documented delivery boundary; the corrected adapter preserves non-adjacent forward trades and journals structured continuity evidence
- Runtime decision: the VPS runs Node.js 24.18.1 and existing workloads remain isolated
- Next gate: deploy the bounded Jupiter response/reconnect repair and collect one clean 24-hour confirmation; stop this route if no gross 1 bp observation appears
- Operator task: update only the named collector after the repair commit; do not connect a wallet, fund an experiment, purchase data, or build execution
