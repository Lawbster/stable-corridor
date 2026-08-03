# Bybit Public API Contract

**Verified:** 2026-08-02
**Scope:** local, unauthenticated A4 reference adapter only

## Approved products and endpoints

The adapter is fixed to:

| Native product | Canonical product | Research role |
|---|---|---|
| `USDTEUR` | `USDT-EUR` | secondary EUR/stablecoin reference |
| `USDCEUR` | `USDC-EUR` | EUR/USDC reference |
| `USDCUSDT` | `USDC-USDT` | dollar-stablecoin stress reference |

Only these public interfaces are used:

- REST base: `https://api.bybit.com`
- instrument metadata: `GET /v5/market/instruments-info?category=spot&symbol=<approved-product>`
- spot WebSocket: `wss://stream.bybit.com/v5/public/spot`
- topics: `orderbook.200.<symbol>` and `publicTrade.<symbol>`

No credential, signature, authenticated header, private stream, WebSocket trade service, order, account, transfer, or withdrawal endpoint is part of this adapter. The six topics fit within Bybit's documented limit of ten spot arguments in one subscription request.

## Verified instrument rules

A live unauthenticated REST probe returned all three products as `Trading`:

| Product | Tick | Base precision | Minimum quantity | Minimum notional | Maximum limit quantity | Maximum order amount |
|---|---:|---:|---:|---:|---:|---:|
| `USDTEUR` | `0.0001` | `0.01` | `0.01 USDT` | `1 EUR` | `5,768,000 USDT` | `180,000 EUR` |
| `USDCEUR` | `0.0001` | `0.01` | `0.01 USDC` | `1 EUR` | `6,837,000 USDC` | `180,000 EUR` |
| `USDCUSDT` | `0.0001` | `0.01` | `0.01 USDC` | `5 USDT` | `35,000,000 USDC` | `16,000,000 USDT` |

The operator observed an approximately one-unit minimum in checked spot order forms. Because `USDCUSDT` public metadata reports `5 USDT`, collection and later research use current public instrument metadata as the exact product-rule authority.

Metadata responses are bounded to 1 MiB by default. The requested symbol, base asset, and quote asset must match the configured contract. A changed or malformed contract fails closed.

## Subscription and heartbeat

On connection open, the transport sends one public subscription for the six approved topics. It does not consider the subscription usable until Bybit replies with `success=true`, `ret_msg=subscribe`, and `op=subscribe`.

The transport sends the documented application heartbeat `{"op":"ping"}` every 20 seconds. A successful `pong` is counted for diagnostics. A rejected subscription, failed pong, non-text frame, oversized frame, processing error, or socket error closes the bounded session and makes affected products ineligible.

Reconnect scheduling is intentionally outside the transport. A supervisor must create a fresh connection/session and the adapter requires fresh metadata, acknowledgement, and snapshots before eligibility returns.

Bybit documents that depth-200 messages are change-driven, so a quiet valid
book need not emit market traffic on a fixed cadence. The first 20-hour VPS
run showed that the original 30-second per-product silence threshold caused
119 otherwise successful venue-session recoveries, all led by quiet
`USDCEUR`. The pilot threshold is therefore five minutes. Application pongs
remain independently counted every 20 seconds; the five-minute market bound
remains a conservative periodic refresh for a potentially silent individual
subscription.

## Order-book semantics

Each `orderbook.200` message carries:

- `ts`: Bybit message-generation time;
- `cts`: matching-engine timestamp, persisted as source time;
- `u`: order-book update ID;
- `seq`: cross sequence;
- `b` and `a`: price/quantity levels.

A `snapshot` replaces the tracked book. A `delta` supplies absolute quantities: a new price inserts, an existing price replaces its quantity, and quantity `0` removes the level. After a snapshot, each delta must have `u = previous u + 1`, while `seq` must strictly increase. Bybit documents `u=1` snapshots as service-restart snapshots; the adapter accepts one as a recovery checkpoint and replaces prior state.

The tracked book is bounded, must retain at least one bid and ask, and must not be crossed. Invalid input is applied transactionally so a rejected delta cannot partially mutate the last good state.

The normalized venue sequence is `<u>:<seq>`. Checkpoints persist the configured top depth, while the adapter tracks up to the separately configured per-side bound.

## Trade semantics

`publicTrade.<symbol>` messages can contain several trades. The adapter persists:

- trade ID `i`;
- execution timestamp `T`;
- price `p`;
- quantity `v`;
- `S=Buy` as buy aggressor and `S=Sell` as sell aggressor;
- normalized venue sequence `<seq>:<trade-id>`.

Trade IDs are treated as opaque uniqueness keys, not consecutive integers. Cross sequence is required to be nondecreasing because several trades in one message can share it. Timestamps within one message must be nondecreasing. A bounded recent-ID set rejects exact replays without unbounded memory.

Trade arrival is not required for eligibility because a valid but quiet product may have no recent executions. Trades remain independently validated and journaled.

## Eligibility and fail-closed behavior

A product becomes research-eligible only when:

1. the current connection has an acknowledged public subscription;
2. current public metadata is present and reports the product online;
3. a valid order-book snapshot has initialized the book.

It becomes ineligible on:

- missing, duplicate, or out-of-order order-book update IDs;
- non-increasing order-book cross sequence;
- a delta before snapshot;
- a crossed, empty-sided, duplicate-level, or over-limit book;
- malformed metadata or changed asset mapping;
- duplicate or out-of-order trades;
- stale per-product market traffic;
- backwards local receive time;
- malformed/oversized input or a rejected subscription;
- connection close or transport failure.

Unknown future public message types are ignored only after their outer JSON object is validated and only when they are not one of the selected topic families.

## Recorded verification

The deterministic fixture set contains truncated public instrument responses, subscription acknowledgement, pong, a real `USDCUSDT` 200-level snapshot, its next `u+1` delta, and public trade messages including a three-trade message sharing one cross sequence. Tests cover normalization, continuity, reset/reconnect recovery, book integrity, staleness, metadata changes, heartbeat transport, bounded failures, and byte-identical journals.

`npm run check` passes 123 tests across 25 files. The complete npm audit reports zero known vulnerabilities.

## Primary documentation

- Bybit WebSocket connectivity: `https://bybit-exchange.github.io/docs/v5/ws/connect`
- Bybit public order book: `https://bybit-exchange.github.io/docs/v5/websocket/public/orderbook`
- Bybit public trades: `https://bybit-exchange.github.io/docs/v5/websocket/public/trade`
- Bybit instrument metadata: `https://bybit-exchange.github.io/docs/v5/market/instrument`
