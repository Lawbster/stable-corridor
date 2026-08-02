# Kraken Public API Contract

**Verified:** 2026-08-02
**Scope:** unauthenticated spot metadata, L2 order books, trades, status,
heartbeat, normalization, and fail-closed behavior

## Fixed endpoints and products

The adapter uses only:

- `GET https://api.kraken.com/0/public/AssetPairs`;
- `wss://ws.kraken.com/v2`;
- WebSocket v2 `book` with depth `25` and snapshots enabled;
- WebSocket v2 `trade`;
- public `status` and `heartbeat` messages.

The exact native product universe is:

```text
EURC/USDC
EURC/EUR
EURC/USD
USDC/EUR
USDC/USD
```

No authenticated WebSocket, private REST method, token, account, order,
transfer, or withdrawal route is present.

## Metadata observation

A live public `AssetPairs` probe returned all five products as online:

| Product | Tick | Minimum quantity | Minimum cost |
|---|---:|---:|---:|
| `EURC/USDC` | `0.00001` | `4 EURC` | `0.5 USDC` |
| `EURC/EUR` | `0.0001` | `4 EURC` | `0.45 EUR` |
| `EURC/USD` | `0.00001` | `4 EURC` | `0.5 USD` |
| `USDC/EUR` | `0.0001` | `5 USDC` | `0.45 EUR` |
| `USDC/USD` | `0.0001` | `5 USDC` | `0.5 USD` |

The adapter requires an exact response for every configured pair, rejects
unexpected asset mappings or non-online status for research eligibility,
and preserves decimal rules without binary floating-point conversion.

## Book continuity

Kraken WebSocket v2 does not publish a conventional order-book sequence
number. Integrity is established with the venue checksum:

1. apply every price update in the message;
2. remove a level when quantity is zero;
3. truncate each side to the subscribed depth;
4. build the checksum input from the top ten asks low-to-high followed by
   the top ten bids high-to-low;
5. remove decimal points and leading zeroes from the original lossless
   price and quantity strings;
6. compare the unsigned CRC32 with the message checksum.

The normalized `venueSequence` is a local per-connection book-message
ordinal followed by the verified venue checksum. It is not presented as a
Kraken sequence number. Snapshots and every update are checksum-validated
transactionally before the in-memory book is replaced.

Periodic collector checkpoints retain the most recently verified checksum
and book-message ordinal. They do not update market freshness.

## Trade continuity

Kraken defines `trade_id` as a unique sequence for each order book. The
adapter:

- requires strictly increasing IDs after the first observed trade;
- deduplicates recent IDs within a bounded set;
- fails closed on an ID gap or backwards timestamp;
- records Kraken's `side` directly as aggressor side because the public
  contract defines it as taker side.

A trade is not required during startup because quiet products may produce
no trade in a short window. Online metadata, successful book and trade
subscription acknowledgements, online system status, and a valid book
snapshot are required.

## Transport and recovery

The transport accepts text frames only, enforces a configured byte limit,
processes frames serially, and closes the socket on callback or parsing
failure. A rejected subscription, malformed message, checksum mismatch,
crossed or incomplete book, stale feed, changed metadata contract, or
journal failure makes affected data ineligible and closes the connection.

Recovery always creates a new connection ID, reloads public metadata,
resubscribes, and waits for a fresh checksum-valid snapshot. State is not
silently carried across connections.

## Live public probe

On 2026-08-02, a bounded unauthenticated probe received successful book
and trade acknowledgements plus book snapshots for all five products. A
separate `USDC/USD` probe captured a checksum-valid snapshot, update, and
trade fixture used by the deterministic tests.

## Primary documentation

- <https://docs.kraken.com/api/docs/websocket-v2/book/>
- <https://docs.kraken.com/api/docs/websocket-v2/trade/>
- <https://docs.kraken.com/api/docs/websocket-v2/instrument/>
- <https://docs.kraken.com/api/docs/guides/spot-ws-book-v2/>
