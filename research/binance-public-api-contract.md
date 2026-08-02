# Binance Public API Contract

**Verified:** 2026-08-02
**Scope:** A4 public reference adapter only
**Authentication:** none

## Selected public surfaces

The adapter uses Binance's market-data-only hosts:

```text
REST:      https://data-api.binance.vision
WebSocket: wss://data-stream.binance.vision
```

It never uses account, order, user-data, funding, signing, API-key, or listen-key endpoints.

Public REST inputs:

```text
GET /api/v3/exchangeInfo?symbols=<encoded JSON array>
GET /api/v3/depth?symbol=<native symbol>&limit=1000
```

Public combined WebSocket inputs per configured symbol:

```text
<lowercase-symbol>@depth@100ms
<lowercase-symbol>@trade
```

The server documents a 24-hour connection lifetime, ping control frames every 20 seconds, and disconnection when the matching pong is not received within one minute. The Node.js WebSocket implementation owns control-frame pong handling. A4 adds no automatic reconnect loop; a later collector owner must create a new connection/session and repeat snapshot synchronization.

## Live product verification

An unauthenticated public `exchangeInfo` check on 2026-08-02 returned:

| Native product | Canonical product | Status | Tick | Quantity step | Minimum notional | Post Only equivalent |
|---|---|---|---:|---:|---:|---|
| `EURUSDC` | `EUR-USDC` | `TRADING` | `0.0001` | `0.1 EUR` | `5 USDC` | `LIMIT_MAKER` |
| `EURIUSDC` | `EURI-USDC` | `TRADING` | `0.0001` | `0.1 EURI` | `5 USDC` | `LIMIT_MAKER` |
| `USDCUSD` | `USDC-USD` | `TRADING` | `0.00001` | `1 USDC` | `5 USD` | `LIMIT_MAKER` |

All three products allowed spot trading at the observation time. These are public product facts, not evidence of authenticated account access or durable future availability.

The live combined stream produced depth updates for all three products and trades for `EURUSDC` and `USDCUSD` during a bounded probe. `EURIUSDC` produced depth updates but no trade during that short window. Trade arrival is therefore collected and continuity-checked but is not required before a synchronized, online book becomes research-eligible.

## Local order-book synchronization

Binance depth messages contain:

```text
U  first update ID in the event
u  final update ID in the event
b  absolute bid quantities by price
a  absolute ask quantities by price
```

The adapter follows the documented synchronization sequence:

1. Open the WebSocket and buffer bounded diff-depth messages.
2. Fetch a REST depth snapshot.
3. Discard buffered events whose `u` is not newer than `lastUpdateId`.
4. Require the first retained event to bridge `lastUpdateId + 1`.
5. Apply retained and subsequent events only when they overlap the next expected update ID.
6. Treat each quantity as the complete new quantity; a zero quantity removes the level.
7. Fail closed on gaps, out-of-order updates, crossed books, missing book sides, invalid decimals, or configured bounds.

If the snapshot is older than the first buffered event, the adapter remains `recovering`, retains the bounded buffer, and requests a newer snapshot rather than publishing a false gap or incomplete book.

Buffered initialization deltas are folded into one recovery-safe checkpoint at the REST snapshot's receive time. This prevents replay from ordering pre-snapshot deltas before the checkpoint. Once synchronized, every diff is journaled with its exchange event time, local receive time, first/final update IDs, and absolute changes.

The REST snapshot is intentionally limited to 1,000 levels per side. Binance notes that levels beyond the requested snapshot are unknown until they change. The research stream retains only the configured top depth, fails if its tracked map exceeds the configured bound, and must periodically assess whether the 1,000-level bootstrap remains sufficient during the forward pilot.

## Trades and side normalization

The raw trade stream supplies trade ID `t`, price `p`, quantity `q`, trade time `T`, and `m`, which means the buyer was the maker.

Normalized aggressor side:

```text
m = true   -> sell aggressor
m = false  -> buy aggressor
```

After the first observed trade in a connection, trade IDs must increment exactly by one. A duplicate, reversal, or gap makes that product ineligible until a new connection is synchronized.

## Metadata and availability

`exchangeInfo` is the authority for symbol status, asset mapping, tick, lot size, notional limits, spot availability, and supported order types.

The adapter:

- maps `TRADING` plus spot permission to `online`;
- maps `HALT`, `BREAK`, or disabled spot trading to `offline`;
- treats unknown states as ineligible;
- requires the expected base/quote mapping and required filters;
- bounds REST response size before JSON parsing;
- publishes both normalized instrument and market-status events.

Binance has no selected per-product heartbeat or status WebSocket in A4.
Product liveness is measured from its own depth/trade traffic. The first VPS
sample observed a legitimate `EURIUSDC` quiet period longer than 30 seconds,
so the reviewed pilot threshold is 120 seconds. This remains conservative
and must be reevaluated from the forward dataset.

## Bounds and recovery

The reviewed example uses:

```text
persisted checkpoint depth:       20 levels per side
REST bootstrap depth:             1,000 levels per side
maximum tracked levels:           10,000 per side
maximum buffered depth events:    10,000 per product
maximum WebSocket frame:          1 MiB
stale threshold:                  120 seconds per product
maximum REST response:            2 MiB
```

Malformed or oversized public input fails closed. Unknown future public event types are ignored only after the bounded combined-stream wrapper is validated. No reconnect, deployment, PM2 process, opportunity decision, or order capability is part of A4.

## Fixture policy

Committed fixtures are truncated public observations containing no account data. Tests cover:

- metadata and filter normalization;
- snapshot plus buffered-delta synchronization;
- absolute updates and zero removal;
- stale snapshot retry;
- depth and trade continuity gaps;
- crossed and incomplete books;
- stale/recovery behavior;
- offline/online metadata refresh;
- reconnect state;
- frame and response bounds;
- deterministic byte-identical journals.

No default test requires network access.

## Primary documentation

- Binance Spot API WebSocket streams: `https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md`
- Binance Spot REST API: `https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md`
- Binance market-data-only endpoints: `https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md`
