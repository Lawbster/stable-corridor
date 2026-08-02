# Coinbase Public API Contract

**Observed:** 2026-08-02
**Scope:** A3 public market data only
**Authentication:** none

## Selected interfaces

The adapter uses Coinbase Advanced Trade's public market-data WebSocket:

```text
wss://advanced-trade-ws.coinbase.com
```

It sends one unauthenticated subscription message for each channel:

```text
level2
market_trades
status
heartbeats
```

The approved products are:

```text
EURC-USDC
USDC-EUR
```

Instrument rules come from the unauthenticated Advanced Trade public product
endpoint:

```text
GET https://api.coinbase.com/api/v3/brokerage/market/products/{product_id}
```

Requests set `cache-control: no-cache`. The adapter has no user endpoint, JWT,
signing, credential, portfolio, balance, or order capability.

## Why the Exchange WebSocket was rejected

The general Coinbase Exchange channel documentation still describes `level2`
as public. A live unauthenticated probe on 2026-08-02 returned:

```text
Failed to subscribe: level2, level3, and full channels now require authentication
```

The Exchange `matches` and `heartbeat` subscriptions still succeeded, but they
cannot provide a synchronized order book alone. Adding credentials would violate
the approved collector boundary.

The Advanced Trade public endpoint was then probed without a JWT. It delivered:

- full `EURC-USDC` and `USDC-EUR` level2 snapshots;
- absolute-quantity level2 updates;
- market-trade snapshots and updates;
- product status;
- one-second heartbeats.

## Normalization rules

- The WebSocket envelope `sequence_num` is tracked across every received frame,
  including supported future channel types.
- A missing or non-increasing sequence fails the connection closed.
- Level2 `new_quantity` is an absolute size; zero removes the level.
- `offer` is normalized to `ask`.
- The book update is transactional and is rejected if it produces an empty,
  oversized, or crossed book.
- The initial full book is held only up to the configured hard limit; persisted
  checkpoints are bounded to the configured research depth.
- Market-trade `side` is the maker side. It is inverted when normalized to the
  schema's aggressor side.
- Initial trade snapshots are ordered by numeric trade ID before persistence.
- Subsequent trade IDs must be consecutive for each product.
- Exchange event time is preserved as `sourceTimestampMs`; receipt is captured
  immediately as `receivedTimestampMs`.
- A product becomes research-eligible only after book, trade, status, and
  heartbeat readiness are all established.
- Gaps, malformed frames, crossed books, stale connections, and unavailable
  product status make the product ineligible.

## Bounded defaults

```text
Persisted book depth:           20 levels per side
Maximum in-memory levels:       10,000 per side
Maximum WebSocket frame:        8 MiB
Stale threshold:                5 seconds
Checkpoint planning cadence:    60 seconds
```

The status channel is used only for availability. Its live `quote_increment`
field disagreed with the public product endpoint for `EURC-USDC`; REST product
metadata remains authoritative for increments and size limits.

## Fixture policy

Fixtures contain truncated, non-sensitive public messages observed from the
selected endpoint. They retain message shape, public prices, sizes, trade IDs,
timestamps, and sequences needed to prove deterministic normalization. No
account data or authenticated frame is retained.

Default tests are offline. The live probes used to select this contract are not
part of `npm run check`.
