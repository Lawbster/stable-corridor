# Repaired Jupiter 72-hour edge screen

Date: 2026-08-10

## Scope and evidence status

The repaired Jupiter run,
`0838a445-4675-4b2f-b70f-089a0c6c951e`, started on deployed commit
`92d3b42` at 2026-08-06 23:30:31 UTC. This screen uses only its daily
finalized immutable journals through 2026-08-09 23:59:59 UTC. The run was
still active at the latest pull, so the current-day open files and their
events are excluded.

The complete local dataset audit passed all 1,108 immutable parts,
24,586,536 events, and 15,301,562,977 logical bytes. The repaired run's
closed prefix contains 9,781,344 events. Its 144 unobserved sequences inside
the closed range are present in mutable open route streams; the complete run
must be stopped and pulled once more before final provenance can be claimed.

The reproducible report is:

```text
backtests/repaired-jupiter-24h-edge-screen-2026-08-10.json
```

## Coverage

The usable comparison window was 72.49 hours:

- 124,208 accepted Jupiter quotes;
- 124,149 eligible Coinbase comparisons;
- one comparison before Coinbase book readiness;
- 58 comparisons while the Coinbase feed was ineligible;
- zero insufficient-depth or crossed-book rejections;
- approximately 8.41 seconds between observations of the same route and
  size under the four-request round robin.

Router observations were dominated by JupiterZ and Metis:

- JupiterZ: 74,462;
- Metis: 40,175;
- OKX: 9,417;
- DFlow: 95.

## Economic result

The model retained the original conservative public-quote assumptions:

- 0.1 bp Coinbase fee;
- 0.01 USDC modeled network cost;
- 2 bp execution buffer;
- prefunded inventory with no transfer in the critical path;
- 3 bp modeled decision threshold.

| Direction | Size | Gross P50 | Gross P99 | Gross max | Modeled max | Modeled >=3 bp |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Buy Coinbase, sell Jupiter | 1,000 | -1.1544 bp | 0.8327 bp | 14.8921 bp | 12.7055 bp | 1 |
| Buy Coinbase, sell Jupiter | 10,000 | -2.7749 bp | -1.2337 bp | 1.0597 bp | -1.0489 bp | 0 |
| Buy Jupiter, sell Coinbase | 1,000 | -1.3578 bp | 0.8860 bp | 16.2911 bp | 14.0909 bp | 3 |
| Buy Jupiter, sell Coinbase | 10,000 | -2.5809 bp | -0.7944 bp | 0.6404 bp | -1.4696 bp | 0 |

Across all eligible comparisons:

- 9,490, or 7.64%, were gross non-negative;
- 234, or 0.188%, reached 1 bp gross;
- eight, or 0.0064%, remained modeled non-negative;
- four, or 0.0032%, reached the modeled 3 bp threshold;
- none of the four remained above 3 bp at the next same-route quote.

The four modeled threshold observations were:

| UTC | Direction | Router | Quote latency | Gross | Modeled net |
| --- | --- | --- | ---: | ---: | ---: |
| 2026-08-07 15:19:52.127 | Buy Jupiter, sell Coinbase | DFlow | 83 ms | 7.3754 bp | 5.1754 bp |
| 2026-08-08 10:55:00.537 | Buy Jupiter, sell Coinbase | Metis | 101 ms | 6.2995 bp | 4.0994 bp |
| 2026-08-08 17:16:11.532 | Buy Coinbase, sell Jupiter | Metis | 186 ms | 14.8921 bp | 12.7055 bp |
| 2026-08-09 12:19:08.170 | Buy Jupiter, sell Coinbase | DFlow | 96 ms | 16.2911 bp | 14.0909 bp |

These are legitimate public-quote anomalies worth preserving, but they are
not an executable-edge result. Each occurred at the 1,000 size, none was
confirmed approximately 8.4 seconds later, and the public quote model still
excludes transaction construction, landing, failure, adverse selection, and
real account behavior.

## Decision

The repaired run rejects a recurring broad Coinbase/Jupiter corridor. The
10,000 routes are economically uninteresting, and another passive extension
of the same four-route collector has low expected information value.

The broad collector should be stopped cleanly and the final run pulled and
audited. If the four anomalies justify a follow-up, it should be a separate,
bounded public-data experiment focused only on the 1,000 routes. Its purpose
would be immediate requoting around a trigger and shorter persistence
measurement, not wallet connection or execution. No execution build is
justified by the present evidence.
