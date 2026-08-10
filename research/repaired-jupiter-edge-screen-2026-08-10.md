# Repaired Jupiter final edge screen

Date: 2026-08-10

## Scope and evidence status

The repaired Jupiter run,
`0838a445-4675-4b2f-b70f-089a0c6c951e`, started on deployed commit
`92d3b42` at 2026-08-06 23:30:31 UTC and stopped cleanly at
2026-08-10 16:20:03 UTC. The final pull contains no open journals.

The complete local dataset audit passed all 1,193 immutable parts,
26,948,264 events, and 16,785,963,093 logical bytes. The repaired run contains
12,143,072 events with contiguous ingest sequences from 0 through 12,143,071,
no duplicates, zero journal errors, and both provenance manifests.

The reproducible report is:

```text
backtests/repaired-jupiter-24h-edge-screen-2026-08-10.json
```

## Coverage

The usable comparison window was 88.82 hours:

- 152,164 accepted Jupiter quotes;
- 152,102 eligible Coinbase comparisons;
- one comparison before Coinbase book readiness;
- 61 comparisons while the Coinbase feed was ineligible;
- zero insufficient-depth or crossed-book rejections;
- approximately 8.41 seconds between observations of the same route and
  size under the four-request round robin.

Router observations were dominated by JupiterZ and Metis:

- JupiterZ: 98,483;
- Metis: 42,995;
- OKX: 10,495;
- DFlow: 129.

## Economic result

The model retained the original conservative public-quote assumptions:

- 0.1 bp Coinbase fee;
- 0.01 USDC modeled network cost;
- 2 bp execution buffer;
- prefunded inventory with no transfer in the critical path;
- 3 bp modeled decision threshold.

| Direction | Size | Gross P50 | Gross P99 | Gross max | Modeled max | Modeled >=3 bp |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Buy Coinbase, sell Jupiter | 1,000 | -1.1171 bp | 0.7631 bp | 189.5154 bp | 187.3289 bp | 3 |
| Buy Coinbase, sell Jupiter | 10,000 | -2.5266 bp | -1.2685 bp | 133.0840 bp | 130.9753 bp | 2 |
| Buy Jupiter, sell Coinbase | 1,000 | -1.2598 bp | 0.8534 bp | 16.2911 bp | 14.0909 bp | 3 |
| Buy Jupiter, sell Coinbase | 10,000 | -2.0707 bp | -0.8193 bp | 0.9049 bp | -1.2051 bp | 0 |

Across all eligible comparisons:

- 9,569, or 6.29%, were gross non-negative;
- 242, or 0.159%, reached 1 bp gross;
- 13, or 0.0085%, remained modeled non-negative;
- eight, or 0.0053%, reached the modeled 3 bp threshold;
- none of the eight remained above 3 bp at the next same-route quote.

The eight modeled threshold observations, grouped into six time episodes,
were:

| UTC | Direction | Size | Router | Quote latency | Gross | Modeled net |
| --- | --- | ---: | --- | ---: | ---: | ---: |
| 2026-08-07 15:19:52.127 | Buy Jupiter, sell Coinbase | 1,000 | DFlow | 83 ms | 7.3754 bp | 5.1754 bp |
| 2026-08-08 10:55:00.537 | Buy Jupiter, sell Coinbase | 1,000 | Metis | 101 ms | 6.2995 bp | 4.0994 bp |
| 2026-08-08 17:16:11.532 | Buy Coinbase, sell Jupiter | 1,000 | Metis | 186 ms | 14.8921 bp | 12.7055 bp |
| 2026-08-09 12:19:08.170 | Buy Jupiter, sell Coinbase | 1,000 | DFlow | 96 ms | 16.2911 bp | 14.0909 bp |
| 2026-08-10 07:40:40.185 | Buy Coinbase, sell Jupiter | 1,000 | DFlow | 117 ms | 23.6227 bp | 21.4362 bp |
| 2026-08-10 07:40:44.371 | Buy Coinbase, sell Jupiter | 10,000 | OKX | 103 ms | 11.1009 bp | 8.9922 bp |
| 2026-08-10 09:38:28.547 | Buy Coinbase, sell Jupiter | 1,000 | Metis | 133 ms | 189.5154 bp | 187.3289 bp |
| 2026-08-10 09:38:33.511 | Buy Coinbase, sell Jupiter | 10,000 | Metis | 896 ms | 133.0840 bp | 130.9753 bp |

These are legitimate public-quote anomalies worth preserving, but they are
not an executable-edge result. The two August 10 clusters included both
sizes, but each response was a non-guaranteed aggregator quote with no
transaction or taker. The 09:38 Metis outputs reverted from 1,177.81 to
1,155.90 USDC at size 1,000 and from 11,713.69 to 11,557.70 USDC at size
10,000 on the next same-route observations. The public model still excludes
transaction construction, landing, failure, adverse selection, and real
account behavior.

## Decision

The repaired run rejects a recurring broad Coinbase/Jupiter corridor. The
ordinary 10,000-size distribution remains negative despite two clustered
outliers, and another passive extension of the same four-route collector has
low expected information value.

The broad collector is now stopped and its final run is verified. VPS
compression and source reclamation are approved after preserving this local
source mirror. If the six anomaly episodes justify a follow-up, it should be
a separate bounded experiment focused on immediate requoting, shorter
persistence measurement, and transaction-construction feasibility without
signing or submission. No live execution build is justified by the present
evidence.
