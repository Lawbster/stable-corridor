# Initial Jupiter edge screen

Date: 2026-08-07

## Scope and evidence status

The first deployed Jupiter observation run,
`df227f61-bda0-45e1-aa6f-f02aee970982`, started on commit `75fb534` at
2026-08-06 07:36:36 UTC.

A local pull captured stable copies of the mutable Coinbase and Jupiter
`.jsonl.open` files for the initial screen. The repaired deployment then
closed the original run cleanly at 2026-08-06 23:30:30 UTC, finalizing its
Jupiter quote journal and both run manifests. After adding `dex_quote` to the
dataset auditor's closed-route allowlist, the full local audit passed all 836
immutable parts and all 14,805,192 events.

The formal immutable replay report is tracked at:

```text
backtests/initial-jupiter-edge-screen-2026-08-07.json
```

The finalized run contains 2,304,010 events with contiguous ingest sequences
from 0 through 2,304,009, no duplicates, and both provenance manifests. Its
formal result matches the provisional open-file screen.

## Coverage

The usable window was 9.47 hours:

- 14,535 accepted Jupiter quotes;
- 14,529 eligible Coinbase comparisons;
- one comparison before Coinbase book readiness;
- five comparisons while the Coinbase feed was ineligible;
- zero insufficient-depth or crossed-book rejections;
- 121 ms quote-latency median, 259 ms P95, and 391 ms P99.

Router observations were:

- JupiterZ: 13,126;
- Metis: 1,001;
- OKX: 405;
- DFlow: 3.

## Economic result

The model used:

- 0.1 bp Coinbase fee;
- 0.01 USDC modeled network cost;
- 2 bp execution buffer;
- pre-funded inventory with no transfer in the critical path.

| Direction | Size | Gross P50 | Gross P99 | Gross max | Modeled max |
| --- | ---: | ---: | ---: | ---: | ---: |
| Buy Coinbase, sell Jupiter | 1,000 | -1.1243 bp | -0.3927 bp | -0.0097 bp | -2.1964 bp |
| Buy Coinbase, sell Jupiter | 10,000 | -1.9092 bp | -1.4035 bp | -1.2093 bp | -3.3180 bp |
| Buy Jupiter, sell Coinbase | 1,000 | -1.1199 bp | 0.0632 bp | 0.6552 bp | -1.5448 bp |
| Buy Jupiter, sell Coinbase | 10,000 | -1.7917 bp | -0.3864 bp | 0.2753 bp | -1.8347 bp |

No gross comparison reached 1 bp. Only 60 were gross non-negative: 44 at
1,000 and 16 at 10,000, all in the buy-Jupiter direction. No modeled
comparison was non-negative under the selected assumptions. Even the
zero-Coinbase-fee sensitivity had a negative maximum of approximately
`-1.4448 bp`.

This immutable result is enough to reject the presence of a conspicuous,
recurring spread in the observed window. It is not enough to prove that rare
opportunities never occur.

## Collection defects and repair gate

The feed accepted approximately 89.5% of scheduled requests before stopping.
Rejected public responses exposed two valid Jupiter response variants:

- scientific notation in `priceImpactPct`;
- fractional `percent` values for split routes, while `bps` remained integer.

After a run of rejected responses exceeded the 30-second staleness threshold,
the adapter attempted recovery. Its stopped-event lifecycle marked the
adapter inactive before constructing the event, causing a synchronous error
and preventing reconnect scheduling. Jupiter stopped at
2026-08-06 17:05:39 UTC while the other 13 feeds and all journals remained
operational.

The repair:

- expands bounded scientific decimal strings exactly before persistence;
- accepts finite positive fractional route percentages while continuing to
  persist integer route `bps`;
- emits stopped status before adapter deactivation so normal reconnect
  scheduling can proceed;
- adds regression coverage for all three observed failure shapes.

The repair was deployed as commit `92d3b42`. The replacement run,
`0838a445-4675-4b2f-b70f-089a0c6c951e`, started with all 14 feeds healthy.
The next economic gate remains one clean 24-hour run after repair. If it
again contains no gross 1 bp observation, further collection for this route
is not justified.
