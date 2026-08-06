# Free Historical Edge Screen

**Prepared:** 2026-08-06  
**Source:** free first-of-month Tardis public-market archives  
**Dates:** 24 sampled UTC days from 2024-09-01 through 2026-08-01  
**Observed daily spans:** approximately 575 hours  
**Conclusion:** current Coinbase maker corridor is an economic no-go at
the observed access and fee tiers

## Purpose

This follow-up tests whether the thin initial 56-hour result was merely a
quiet local regime. It uses no purchased data and no authenticated
exchange endpoint. The input dates are discontinuous first days of each
month, giving broader regimes but not a conventional continuous
backtest.

The normalized archive contains:

- 120 gzip-only journal parts;
- 13,424,304 normalized events;
- 11,267,466,985 logical journal bytes;
- 275,064,951 compressed journal bytes.

The independent archive audit passed all 120 parts with zero integrity
failures. The reports are:

- `backtests/free-history-checkpoint-edge-screen-2026-08-06.json`;
- `backtests/free-history-trade-through-screen-2026-08-06.json`.

## Method

The method retains the initial screen's no-look-ahead rules:

- Coinbase `EURC-USDC` is the candidate maker venue;
- Binance `EURUSDC`, inverted Bybit `USDCEUR`, and inverted Kraken
  `USDC/EUR` form the median reference;
- every reference must already have arrived and be at most 90 seconds
  old;
- high confidence requires no more than 2 bp dispersion across the
  reference venues;
- Coinbase target observations are sampled no more than once per minute;
- the maker trade-through proxy assumes a 250 ms acknowledgement delay,
  arrival at the displayed queue tail, and a 60-second horizon.

Vendor local timestamps represent arrival at the vendor's collection
infrastructure, not at the Stable Corridor VPS. The results screen market
structure, not our production latency.

## Checkpoint result

The archive supplied 26,292 eligible Coinbase samples. Only 8,255 met the
strict three-reference consensus filter; reference dispersion across all
eligible samples had a 4.42 bp median, which confirms that independent
venue pricing is itself noisy in these thin pairs.

| Measure | Result |
|---|---:|
| High-confidence observed daily spans | approximately 575 hours |
| Median Coinbase spread | 0.87 bp |
| P95 Coinbase spread | 2.63 bp |
| Median absolute mid dislocation | 0.60 bp |
| P95 absolute mid dislocation | 1.93 bp |
| P99 absolute mid dislocation | 2.90 bp |
| Maximum high-confidence dislocation | 7.32 bp |
| Samples at or above 2 bp | 377 / 8,255, or 4.57% |
| Samples at or above 3 bp | 65 / 8,255, or 0.79% |
| Samples at or above 5 bp | 7 / 8,255, or 0.08% |
| Distinct 2 bp episodes | 240 |
| Distinct 3 bp episodes | 53 |
| Distinct 5 bp episodes | 5 |

The maximum is therefore no longer below 5 bp. This is enough to pass a
pure dislocation threshold, but it is not enough to establish useful
execution economics.

The signals were directionally unbalanced: 5,967 high-confidence samples
showed Coinbase cheap and 2,288 showed Coinbase rich. First-of-month
sampling, holidays, and venue-specific liquidity can bias this result.

## Trade-through result

The 377 qualifying observations formed 240 distinct episodes: 204
hypothetical Coinbase bids and 36 asks.

| Horizon | Price touched | Visible queue cleared | Queue plus 100 EURC cleared |
|---:|---:|---:|---:|
| 5 seconds | 60 / 240 | 3 / 240 | 3 / 240 |
| 30 seconds | 138 / 240 | 16 / 240 | 12 / 240 |
| 60 seconds | 168 / 240 | 22 / 240 | 20 / 240 |

The median correctly sided aggressive volume was only 0.49% of the
initially visible queue; P75 was 5.82%. A small number of low-queue or
large-trade events dominate the upper tail.

Size sensitivity over the 24 observed days:

| Order size | Proxy full fills | Gross per observed day | After 1 bp buffer | After 2 bp buffer |
|---:|---:|---:|---:|---:|
| 100 EURC | 20 / 240 | 0.032 USDC | 0.022 USDC | 0.012 USDC |
| 500 EURC | 16 / 240 | 0.129 USDC | 0.091 USDC | 0.052 USDC |
| 1,000 EURC | 9 / 240 | 0.148 USDC | 0.105 USDC | 0.061 USDC |
| 5,000 EURC | 1 / 240 | 0.091 USDC | 0.069 USDC | 0.048 USDC |
| 10,000 EURC | 1 / 240 | 0.182 USDC | 0.138 USDC | 0.095 USDC |

The 5,000 and 10,000 EURC rows are the same single event at
2025-01-01T00:56:54Z. It had a 4.20 bp selected gross maker edge and an
11,544 EURC correctly sided public trade-through. It is not repeatable
capacity evidence.

All amounts remain optimistic marks to contemporaneous fair value. They
exclude adverse selection, the opposite-side exit, finite inventory,
post-only rejection, partial-fill management, and rebalancing.

## Decision

The wider archive finds occasional material price differences, but the
gross dollar opportunity and queue clearance are too small to justify an
execution stack. Even the optimistic 1,000 EURC proxy produced only 3.56
USDC gross across all 24 observed days, before completing an inventory
cycle.

This is a no-go for the current Coinbase maker corridor at the observed
retail access and fee tiers. Do not build authenticated execution,
inventory services, dashboards, or generalized strategy infrastructure
for this thesis.

The live collector may continue for another one or two weeks because its
marginal operating cost is small and it measures the current regime from
our VPS. That confirmation is unlikely to reverse an economic shortfall
of this size. A final full-resolution inspection should be limited to the
20 proxy 100-EURC fills and the single large January event, and should be
performed only if the research value itself is worthwhile.

The useful stop condition is now met: absence of a scalable edge is a
successful research result.
