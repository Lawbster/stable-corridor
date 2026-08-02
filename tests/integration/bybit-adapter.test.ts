import { describe, expect, it } from "vitest";

import type { NormalizedEvent } from "../../src/collector/schema/events.js";
import { BybitPublicAdapter } from "../../src/venues/bybit/adapter.js";
import {
  bybitOrderbookDelta,
  bybitOrderbookSnapshot,
  bybitPong,
  bybitPublicTrade,
  bybitPublicTradeBatch,
  bybitSubscriptionAck,
  bybitUsdcUsdtInstrument
} from "../fixtures/bybit.js";

const collectorRunId = "11111111-1111-4111-8111-111111111111";
const firstConnectionId = "22222222-2222-4222-8222-222222222222";
const secondConnectionId = "33333333-3333-4333-8333-333333333333";
const receivedBase = bybitOrderbookSnapshot.ts + 10_000;

function newAdapter(): BybitPublicAdapter {
  return new BybitPublicAdapter({
    products: ["USDCUSDT"],
    collectorRunId,
    depth: 2,
    maxTrackedLevelsPerSide: 100,
    maxRecentTradeIds: 100,
    staleAfterMs: 5_000
  });
}

function eventTypes(events: readonly NormalizedEvent[]): readonly string[] {
  return events.map((event) => event.eventType);
}

function initialize(adapter: BybitPublicAdapter): void {
  adapter.beginConnection(firstConnectionId, receivedBase);
  adapter.ingestInstrument(
    "USDCUSDT",
    bybitUsdcUsdtInstrument,
    receivedBase + 1
  );
  adapter.ingest(bybitSubscriptionAck, receivedBase + 2);
  adapter.ingest(bybitOrderbookSnapshot, receivedBase + 3);
}

describe("Bybit public adapter", () => {
  it("becomes healthy from metadata, subscription ack, and snapshot", () => {
    const adapter = newAdapter();
    const connecting = adapter.beginConnection(
      firstConnectionId,
      receivedBase
    );
    expect(connecting[0]).toMatchObject({
      venue: "bybit",
      product: "USDC-USDT",
      nativeProduct: "USDCUSDT",
      payload: {
        state: "connecting",
        eligibleForResearch: false
      }
    });

    const metadata = adapter.ingestInstrument(
      "USDCUSDT",
      bybitUsdcUsdtInstrument,
      receivedBase + 1
    );
    expect(eventTypes(metadata)).toEqual(["instrument", "market_status"]);
    expect(metadata[0]).toMatchObject({
      source: "rest",
      payload: {
        tickSize: "0.0001",
        quantityStep: "0.01",
        minimumNotional: "5"
      }
    });
    expect(
      adapter.ingest(bybitSubscriptionAck, receivedBase + 2)
    ).toEqual([]);

    const ready = adapter.ingest(
      bybitOrderbookSnapshot,
      receivedBase + 3
    );
    expect(eventTypes(ready)).toEqual([
      "book_checkpoint",
      "feed_status"
    ]);
    expect(ready[0]).toMatchObject({
      source: "websocket",
      sourceTimestampMs: bybitOrderbookSnapshot.cts,
      venueSequence: "8559640:157068563752",
      payload: {
        bids: [
          { price: "1.0008", quantity: "4047095.69" },
          { price: "1.0007", quantity: "12561509.08" }
        ],
        asks: [
          { price: "1.0009", quantity: "7453939.05" },
          { price: "1.001", quantity: "49000.75" }
        ],
        depth: 2,
        isRecovery: false
      }
    });
    expect(ready[1]).toMatchObject({
      payload: { state: "healthy", eligibleForResearch: true }
    });
    expect(adapter.diagnostics()).toMatchObject({
      active: true,
      subscriptionReady: true,
      reconnectCount: 0,
      products: [
        {
          state: "healthy",
          bookReady: true,
          metadataReady: true,
          tradeSeen: false,
          lastBookUpdateId: "8559640",
          lastBookCrossSequence: "157068563752",
          gapCount: 0,
          snapshotCount: 1
        }
      ]
    });
  });

  it("normalizes continuous absolute deltas and trade batches", () => {
    const adapter = newAdapter();
    initialize(adapter);

    const delta = adapter.ingest(
      bybitOrderbookDelta,
      receivedBase + 4
    );
    expect(eventTypes(delta)).toEqual(["book_delta"]);
    expect(delta[0]).toMatchObject({
      venueSequence: "8559641:157068564373",
      payload: {
        updateSemantics: "absolute",
        firstVenueSequence: "8559641",
        lastVenueSequence: "8559641",
        changes: [
          { side: "bid", price: "1.0008", quantity: "4132998.99" },
          { side: "ask", price: "1.0009", quantity: "7453629.2" }
        ]
      }
    });

    const firstTrade = adapter.ingest(
      bybitPublicTrade,
      receivedBase + 5
    );
    expect(eventTypes(firstTrade)).toEqual(["trade"]);
    expect(firstTrade[0]).toMatchObject({
      venueSequence:
        "157068564370:2210000001554675568",
      payload: {
        tradeId: "2210000001554675568",
        price: "1.0009",
        quantity: "309.85",
        aggressorSide: "buy"
      }
    });

    const batch = adapter.ingest(
      bybitPublicTradeBatch,
      receivedBase + 6
    );
    expect(eventTypes(batch)).toEqual(["trade", "trade", "trade"]);
    expect(batch.map((event) => event.payload)).toEqual([
      expect.objectContaining({ tradeId: "2210000001554675572" }),
      expect.objectContaining({ tradeId: "2210000001554675573" }),
      expect.objectContaining({ tradeId: "2210000001554675574" })
    ]);
    expect(adapter.diagnostics().products[0]).toMatchObject({
      tradeSeen: true,
      lastTradeSequence: "157068565637"
    });
  });

  it("fails closed on book update and cross-sequence discontinuities", () => {
    const updateGap = newAdapter();
    initialize(updateGap);
    expect(
      updateGap.ingest(
        {
          ...bybitOrderbookDelta,
          data: { ...bybitOrderbookDelta.data, u: 8559642 }
        },
        receivedBase + 4
      )[0]
    ).toMatchObject({
      payload: {
        state: "gapped",
        eligibleForResearch: false,
        reason: "orderbook_update_gap:8559640->8559642"
      }
    });

    const outOfOrder = newAdapter();
    initialize(outOfOrder);
    expect(
      outOfOrder.ingest(
        {
          ...bybitOrderbookDelta,
          data: { ...bybitOrderbookDelta.data, u: 8559640 }
        },
        receivedBase + 4
      )[0]
    ).toMatchObject({
      payload: { reason: "orderbook_update_out_of_order" }
    });

    const crossSequence = newAdapter();
    initialize(crossSequence);
    expect(
      crossSequence.ingest(
        {
          ...bybitOrderbookDelta,
          data: {
            ...bybitOrderbookDelta.data,
            seq: bybitOrderbookSnapshot.data.seq
          }
        },
        receivedBase + 4
      )[0]
    ).toMatchObject({
      payload: { reason: "orderbook_cross_sequence_out_of_order" }
    });
  });

  it("fails closed on pre-snapshot deltas, crossed books, and duplicate trades", () => {
    const beforeSnapshot = newAdapter();
    beforeSnapshot.beginConnection(firstConnectionId, receivedBase);
    expect(
      beforeSnapshot.ingest(bybitOrderbookDelta, receivedBase + 1)[0]
    ).toMatchObject({
      payload: { reason: "orderbook_delta_before_snapshot" }
    });

    const crossed = newAdapter();
    initialize(crossed);
    expect(
      crossed.ingest(
        {
          ...bybitOrderbookDelta,
          data: {
            ...bybitOrderbookDelta.data,
            b: [["1.0009", "1"]],
            a: []
          }
        },
        receivedBase + 4
      )[0]
    ).toMatchObject({
      payload: { reason: "book_crossed_book" }
    });
    expect(crossed.diagnostics().products[0]).toMatchObject({
      crossedBookCount: 1,
      bookReady: false
    });

    const duplicateTrade = newAdapter();
    initialize(duplicateTrade);
    duplicateTrade.ingest(bybitPublicTrade, receivedBase + 4);
    expect(
      duplicateTrade.ingest(bybitPublicTrade, receivedBase + 5)[0]
    ).toMatchObject({
      payload: { reason: "duplicate_trade_id" }
    });
  });

  it("marks quiet feeds stale and recovers only on continuous data", () => {
    const adapter = newAdapter();
    initialize(adapter);
    const stale = adapter.checkStaleness(receivedBase + 5_004);
    expect(stale[0]).toMatchObject({
      payload: { state: "stale", eligibleForResearch: false }
    });

    const recovered = adapter.ingest(
      bybitOrderbookDelta,
      receivedBase + 5_005
    );
    expect(eventTypes(recovered)).toEqual([
      "book_delta",
      "feed_status"
    ]);
    expect(recovered[1]).toMatchObject({
      payload: { state: "healthy", eligibleForResearch: true }
    });
  });

  it("keeps unavailable products ineligible until public metadata returns online", () => {
    const adapter = newAdapter();
    adapter.beginConnection(firstConnectionId, receivedBase);
    const unavailable = adapter.ingestInstrument(
      "USDCUSDT",
      {
        ...bybitUsdcUsdtInstrument,
        result: {
          ...bybitUsdcUsdtInstrument.result,
          list: [
            {
              ...bybitUsdcUsdtInstrument.result.list[0],
              status: "Closed"
            }
          ]
        }
      },
      receivedBase + 1
    );
    expect(eventTypes(unavailable)).toEqual([
      "instrument",
      "market_status",
      "feed_status"
    ]);
    expect(unavailable[2]).toMatchObject({
      payload: {
        state: "stopped",
        eligibleForResearch: false,
        reason: "market_status_offline"
      }
    });
    adapter.ingest(bybitSubscriptionAck, receivedBase + 2);
    expect(
      eventTypes(
        adapter.ingest(bybitOrderbookSnapshot, receivedBase + 3)
      )
    ).toEqual(["book_checkpoint"]);

    const online = adapter.ingestInstrument(
      "USDCUSDT",
      bybitUsdcUsdtInstrument,
      receivedBase + 4
    );
    expect(eventTypes(online)).toEqual([
      "instrument",
      "market_status",
      "feed_status"
    ]);
    expect(online[2]).toMatchObject({
      payload: { state: "healthy", eligibleForResearch: true }
    });
  });

  it("tracks heartbeat, snapshot resets, reconnect recovery, and backwards time", () => {
    const adapter = newAdapter();
    initialize(adapter);
    expect(adapter.ingest(bybitPong, receivedBase + 4)).toEqual([]);
    expect(adapter.diagnostics().pongCount).toBe(1);

    const reset = adapter.ingest(
      {
        ...bybitOrderbookSnapshot,
        data: { ...bybitOrderbookSnapshot.data, u: 1, seq: 1 }
      },
      receivedBase + 5
    );
    expect(reset[0]).toMatchObject({
      venueSequence: "1:1",
      payload: { isRecovery: true }
    });

    adapter.endConnection(receivedBase + 6, "test_disconnect");
    adapter.beginConnection(secondConnectionId, receivedBase + 7);
    adapter.ingestInstrument(
      "USDCUSDT",
      bybitUsdcUsdtInstrument,
      receivedBase + 8
    );
    adapter.ingest(bybitSubscriptionAck, receivedBase + 9);
    const reconnected = adapter.ingest(
      bybitOrderbookSnapshot,
      receivedBase + 10
    );
    expect(reconnected[0]).toMatchObject({
      connectionId: secondConnectionId,
      payload: { isRecovery: true }
    });
    expect(adapter.diagnostics().reconnectCount).toBe(1);

    const backwards = newAdapter();
    backwards.beginConnection(firstConnectionId, receivedBase);
    backwards.ingest(
      bybitSubscriptionAck,
      receivedBase + 2
    );
    expect(
      backwards.ingest(bybitOrderbookSnapshot, receivedBase + 1)[0]
    ).toMatchObject({
      payload: {
        state: "gapped",
        reason: "receive_timestamp_moved_backwards"
      }
    });
  });

  it("fails all configured products on malformed or rejected subscriptions", () => {
    const malformed = newAdapter();
    malformed.beginConnection(firstConnectionId, receivedBase);
    expect(malformed.ingest("{", receivedBase + 1)[0]).toMatchObject({
      payload: { state: "gapped" }
    });

    const rejected = newAdapter();
    rejected.beginConnection(firstConnectionId, receivedBase);
    expect(
      rejected.ingest(
        {
          ...bybitSubscriptionAck,
          success: false,
          ret_msg: "invalid topic"
        },
        receivedBase + 1
      )[0]
    ).toMatchObject({
      payload: {
        state: "gapped",
        reason: "subscription_failed:invalid topic"
      }
    });
  });

  it("emits a bounded periodic checkpoint at the last book sequence", () => {
    const adapter = newAdapter();
    initialize(adapter);

    expect(adapter.checkpoint(receivedBase + 1_000)).toMatchObject([
      {
        eventType: "book_checkpoint",
        sourceTimestampMs: null,
        receivedTimestampMs: receivedBase + 1_000,
        venueSequence: "8559640:157068563752",
        payload: {
          depth: 2,
          isRecovery: false
        }
      }
    ]);
  });
});
