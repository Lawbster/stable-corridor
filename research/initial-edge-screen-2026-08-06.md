# Initial Edge Screen

**Prepared:** 2026-08-06  
**Dataset:** clean manifest-backed run
`f8143606-623e-49bc-a530-0841d36250cf`  
**Observation window:** approximately 56.1 hours  
**Conclusion:** gross margins appear thin; execution viability is not
established

**Follow-up:** the wider free cross-regime screen in
`research/free-history-edge-screen-2026-08-06.md` found occasional
larger dislocations but confirmed an economic no-go after trade-through
and size screening.

## Purpose

This is the first economic screen of the verified pilot dataset. Its job
is to decide whether deeper fill, markout, inventory, and rebalance replay
is justified. It is not a backtested PnL result and does not authorize
execution work.

The reports are reproducible from either source or gzip-only journals:

- `backtests/initial-checkpoint-edge-screen-2026-08-06.json`;
- `backtests/initial-trade-through-screen-2026-08-06.json`.

The production run used verified gzip representations for every selected
part. Running the checkpoint screen from the retained local sources
produced identical output.

## Method

The checkpoint screen processes journal events strictly by local receive
time. For each 60-second Coinbase `EURC-USDC` checkpoint it constructs an
independent crypto-market fair-value composite from the median of:

- Binance `EUR-USDC`;
- inverted Bybit `USDC-EUR`;
- inverted Kraken `USDC-EUR`.

Every reference must already have been received and be no more than 90
seconds old. A high-confidence sample additionally requires the three
reference values to be within 2 basis points from minimum to maximum.

The selected maker gross edge assumes a hypothetical post-only quote at
the displayed Coinbase best bid when EURC is cheap, or best ask when EURC
is rich. It does not assume that quote fills.

The trade-through screen groups consecutive `2+ bp` high-confidence
checkpoint observations into episodes. For each episode it assumes:

- arrival 250 milliseconds after the signal;
- placement at the back of the displayed top-level queue;
- a 60-second observation horizon;
- only correctly sided Coinbase aggressive trades at or through the quote
  consume the queue;
- no queue cancellations.

This is a fill-plausibility proxy. Public trade-through is not
exchange-confirmed fill evidence.

## Checkpoint result

The clean run supplied 3,450 eligible target samples, of which 2,670 met
the 2 bp reference-consensus filter.

| Measure | Result |
|---|---:|
| Median Coinbase spread | 0.87 bp |
| 95th percentile Coinbase spread | 1.74 bp |
| Median absolute mid dislocation | 0.43 bp |
| 95th percentile absolute mid dislocation | 1.73 bp |
| 99th percentile absolute mid dislocation | 2.60 bp |
| Maximum high-confidence mid dislocation | 4.33 bp |
| High-confidence samples at or above 2 bp | 70 / 2,670, or 2.62% |
| High-confidence samples at or above 3 bp | 17 / 2,670, or 0.64% |
| High-confidence samples at or above 5 bp | 0 |
| Longest 2 bp episode | approximately 4 minutes |
| Longest 3 bp episode | approximately 1 minute |

The result is stable across the observed UTC dates. Daily median absolute
dislocation remained near 0.43-0.45 bp, and no daily maximum exceeded
4.34 bp.

Changing the reference-dispersion ceiling did not change the conclusion:

| Reference ceiling | Samples | Median | P95 | Maximum | 2+ bp share |
|---:|---:|---:|---:|---:|---:|
| 1 bp | 1,213 | 0.45 bp | 1.71 bp | 3.51 bp | 2.80% |
| 2 bp | 2,670 | 0.43 bp | 1.73 bp | 4.33 bp | 2.62% |
| 3 bp | 3,048 | 0.45 bp | 1.74 bp | 4.33 bp | 2.66% |

## Trade-through result

The `2+ bp` observations formed 62 distinct episodes: 28 indicated a
Coinbase bid and 34 a Coinbase ask.

| Horizon | Price touched | Visible queue cleared | Queue plus 100 EURC cleared |
|---:|---:|---:|---:|
| 5 seconds | 16 / 62 | 3 / 62 | 2 / 62 |
| 30 seconds | 37 / 62 | 11 / 62 | 9 / 62 |
| 60 seconds | 43 / 62 | 14 / 62 | 13 / 62 |

The median qualifying aggressive volume was only 3.58% of the initially
visible queue. A small number of low-queue episodes dominate the upper
tail.

Size sensitivity, using the same 60-second trade-through proxy:

| Order size | Proxy full fills | Gross mark-to-fair per day | After 1 bp buffer | After 2 bp buffer |
|---:|---:|---:|---:|---:|
| 100 EURC | 13 / 62 | 0.21 USDC | 0.14 USDC | 0.08 USDC |
| 500 EURC | 9 / 62 | 0.71 USDC | 0.49 USDC | 0.27 USDC |
| 1,000 EURC | 8 / 62 | 1.25 USDC | 0.86 USDC | 0.47 USDC |
| 5,000 EURC | 1 / 62 | 0.65 USDC | 0.41 USDC | 0.16 USDC |
| 10,000 EURC | 0 / 62 | 0 | 0 | 0 |

These values are gross marks to the contemporaneous fair-value estimate.
They are not completed inventory cycles. The buffers are simple edge
haircuts, not a substitute for adverse-selection or rebalance replay.

## Economic interpretation

The dataset does not support building broad execution infrastructure now.
Most observed dislocations are smaller than the costs and uncertainty that
still need to be modeled. The rare larger observations show some fill
plausibility, but the absolute gross proceeds are small and do not scale
linearly because visible queue clearance collapses with order size.

The evidence is not yet a definitive no-go because:

- 60-second checkpoints can miss shorter dislocations;
- queue cancellations may improve actual priority relative to this proxy;
- public trade-through does not prove a fill;
- adverse selection after the apparent fill is not measured;
- exit timing and opposite-side fill probability are not measured;
- inventory, peg, venue, and rebalance costs remain absent;
- the reference composite is crypto-derived rather than conventional FX;
- the observation window is much shorter than 45-60 days.

## Narrow next gate

Do not build a general shadow bot or execution stack. The next research
task is a focused full-resolution replay of the 62 detected episodes:

1. reconstruct the Coinbase and reference books from checkpoints and
   deltas around each episode;
2. model acknowledgement, post-only acceptance, queue changes, partial
   fills, and cancellation;
3. calculate 1-second, 5-second, 30-second, and 5-minute fair-value
   markouts after each proxy fill;
4. test opposite-side exit and bounded inventory holding;
5. apply explicit fee, adverse-selection, inventory, and rebalance
   scenarios.

If that focused replay does not produce stable positive completed-cycle
economics, the project should stop or wait for materially better access,
fees, or market structure. A clean no-go remains the expected useful
outcome.
