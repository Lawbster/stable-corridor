import { describe, expect, it } from "vitest";

import {
  CoinbasePublicAdapter
} from "../../src/venues/coinbase/adapter.js";
import type { NormalizedEvent } from "../../src/collector/schema/events.js";
import {
  coinbaseHeartbeat,
  coinbaseLevel2Snapshot,
  coinbaseLevel2Update,
  coinbaseStatusSnapshot,
  coinbaseTradeSnapshot,
  coinbaseTradeUpdate
} from "../fixtures/coinbase.js";

const collectorRunId = "11111111-1111-4111-8111-111111111111";
const firstConnectionId = "22222222-2222-4222-8222-222222222222";
const secondConnectionId = "33333333-3333-4333-8333-333333333333";
const receivedBase = Date.UTC(2026, 7, 2, 0, 54, 0);

function newAdapter(): CoinbasePublicAdapter {
  return new CoinbasePublicAdapter({
    products: ["EURC-USDC"],
    collectorRunId,
    depth: 2,
    maxTrackedLevelsPerSide: 100,
    staleAfterMs: 5_000
  });
}

function eventTypes(events: readonly NormalizedEvent[]): readonly string[] {
  return events.map((event) => event.eventType);
}

function initialize(adapter: CoinbasePublicAdapter): void {
  adapter.beginConnection(firstConnectionId, receivedBase);
  adapter.ingest(coinbaseLevel2Snapshot, receivedBase + 1);
  adapter.ingest(coinbaseTradeSnapshot, receivedBase + 2);
  adapter.ingest(coinbaseStatusSnapshot, receivedBase + 3);
  adapter.ingest(coinbaseHeartbeat, receivedBase + 4);
}

describe("Coinbase public adapter", () => {
  it("normalizes a complete public stream and becomes healthy", () => {
    const adapter = newAdapter();
    const connecting = adapter.beginConnection(
      firstConnectionId,
      receivedBase
    );
    expect(connecting[0]?.payload).toMatchObject({
      state: "connecting",
      eligibleForResearch: false
    });

    const snapshot = adapter.ingest(
      coinbaseLevel2Snapshot,
      receivedBase + 1
    );
    expect(eventTypes(snapshot)).toEqual([
      "book_checkpoint",
      "feed_status"
    ]);
    expect(snapshot[0]).toMatchObject({
      eventType: "book_checkpoint",
      venue: "coinbase",
      product: "EURC-USDC",
      sourceTimestampMs: Date.parse("2026-08-02T00:53:11.056071Z"),
      receivedTimestampMs: receivedBase + 1,
      venueSequence: "0",
      payload: {
        bids: [
          { price: "1.1519", quantity: "8200" },
          { price: "1.1518", quantity: "8683" }
        ],
        asks: [
          { price: "1.1521", quantity: "4172" },
          { price: "1.1522", quantity: "52" }
        ],
        depth: 2,
        isRecovery: false
      }
    });

    const trades = adapter.ingest(
      coinbaseTradeSnapshot,
      receivedBase + 2
    );
    expect(eventTypes(trades)).toEqual(["trade", "trade"]);
    expect(trades.map((event) => event.payload)).toEqual([
      {
        tradeId: "18143643",
        price: "1.152",
        quantity: "1",
        aggressorSide: "buy"
      },
      {
        tradeId: "18143644",
        price: "1.1519",
        quantity: "1",
        aggressorSide: "sell"
      }
    ]);

    const status = adapter.ingest(
      coinbaseStatusSnapshot,
      receivedBase + 3
    );
    expect(status).toHaveLength(1);
    expect(status[0]).toMatchObject({
      eventType: "market_status",
      venueSequence: "2",
      payload: {
        status: "online",
        reason: null
      }
    });

    const heartbeat = adapter.ingest(
      coinbaseHeartbeat,
      receivedBase + 4
    );
    expect(heartbeat).toHaveLength(1);
    expect(heartbeat[0]).toMatchObject({
      eventType: "feed_status",
      venueSequence: "3",
      payload: {
        state: "healthy",
        eligibleForResearch: true,
        reason: null
      }
    });

    const delta = adapter.ingest(
      coinbaseLevel2Update,
      receivedBase + 5
    );
    expect(delta).toHaveLength(1);
    expect(delta[0]).toMatchObject({
      eventType: "book_delta",
      venueSequence: "4",
      payload: {
        updateSemantics: "absolute",
        changes: [
          { side: "bid", price: "1.1519", quantity: "8100" },
          { side: "ask", price: "1.1522", quantity: "0" }
        ]
      }
    });

    const trade = adapter.ingest(
      coinbaseTradeUpdate,
      receivedBase + 6
    );
    expect(trade).toHaveLength(1);
    expect(trade[0]).toMatchObject({
      eventType: "trade",
      venueSequence: "5:18143645",
      payload: {
        tradeId: "18143645",
        aggressorSide: "buy"
      }
    });
    expect(adapter.diagnostics()).toMatchObject({
      active: true,
      lastSequenceNumber: 5,
      reconnectCount: 0,
      products: [
        {
          product: "EURC-USDC",
          state: "healthy",
          bookReady: true,
          tradeReady: true,
          statusReady: true,
          marketStatus: "online",
          lastTradeId: "18143645",
          gapCount: 0
        }
      ]
    });
  });

  it("fails closed on sequence gaps and ignores later frames", () => {
    const adapter = newAdapter();
    adapter.beginConnection(firstConnectionId, receivedBase);
    adapter.ingest(coinbaseLevel2Snapshot, receivedBase + 1);

    const gapped = adapter.ingest(
      { ...coinbaseHeartbeat, sequence_num: 2 },
      receivedBase + 2
    );
    expect(gapped).toHaveLength(1);
    expect(gapped[0]).toMatchObject({
      eventType: "feed_status",
      payload: {
        state: "gapped",
        eligibleForResearch: false,
        reason: "sequence_gap:0->2"
      }
    });
    expect(
      adapter.ingest(
        { ...coinbaseLevel2Update, sequence_num: 3 },
        receivedBase + 3
      )
    ).toEqual([]);
  });

  it("detects malformed, out-of-order, and trade-ID gaps", () => {
    const malformedAdapter = newAdapter();
    malformedAdapter.beginConnection(firstConnectionId, receivedBase);
    expect(
      malformedAdapter.ingest("{", receivedBase + 1)[0]
    ).toMatchObject({
      eventType: "feed_status",
      payload: { state: "gapped" }
    });

    const outOfOrderAdapter = newAdapter();
    outOfOrderAdapter.beginConnection(firstConnectionId, receivedBase);
    outOfOrderAdapter.ingest(coinbaseLevel2Snapshot, receivedBase + 1);
    expect(
      outOfOrderAdapter.ingest(
        { ...coinbaseTradeSnapshot, sequence_num: 0 },
        receivedBase + 2
      )[0]
    ).toMatchObject({
      payload: { reason: "out_of_order_sequence" }
    });

    const tradeGapAdapter = newAdapter();
    initialize(tradeGapAdapter);
    expect(
      tradeGapAdapter.ingest(
        {
          ...coinbaseTradeUpdate,
          sequence_num: 4,
          events: [
            {
              ...coinbaseTradeUpdate.events[0],
              trades: [
                {
                  ...coinbaseTradeUpdate.events[0].trades[0],
                  trade_id: "18143646"
                }
              ]
            }
          ]
        },
        receivedBase + 5
      )[0]
    ).toMatchObject({
      payload: { reason: "trade_id_gap_or_out_of_order" }
    });
  });

  it("detects crossed books without publishing the invalid delta", () => {
    const adapter = newAdapter();
    initialize(adapter);

    const result = adapter.ingest(
      {
        ...coinbaseLevel2Update,
        events: [
          {
            ...coinbaseLevel2Update.events[0],
            updates: [
              {
                side: "bid",
                event_time: "2026-08-02T00:53:12.394041Z",
                price_level: "1.1521",
                new_quantity: "1"
              }
            ]
          }
        ]
      },
      receivedBase + 5
    );

    expect(eventTypes(result)).toEqual(["feed_status"]);
    expect(result[0]).toMatchObject({
      payload: { state: "gapped", reason: "book_crossed_book" }
    });
    expect(adapter.diagnostics().products[0]).toMatchObject({
      crossedBookCount: 1,
      bookReady: false
    });
  });

  it("marks stale streams and recovers on a continuous heartbeat", () => {
    const adapter = newAdapter();
    initialize(adapter);

    const stale = adapter.checkStaleness(receivedBase + 5_005);
    expect(stale[0]).toMatchObject({
      payload: { state: "stale", eligibleForResearch: false }
    });

    const recovered = adapter.ingest(
      {
        ...coinbaseHeartbeat,
        sequence_num: 4,
        timestamp: "2026-08-02T00:54:06Z",
        events: [
          {
            ...coinbaseHeartbeat.events[0],
            heartbeat_counter: 33546
          }
        ]
      },
      receivedBase + 5_006
    );
    expect(recovered[0]).toMatchObject({
      payload: { state: "healthy", eligibleForResearch: true }
    });
  });

  it("makes an unavailable market ineligible until status recovers", () => {
    const adapter = newAdapter();
    initialize(adapter);

    const stopped = adapter.ingest(
      {
        ...coinbaseStatusSnapshot,
        sequence_num: 4,
        events: [
          {
            type: "update",
            products: [
              {
                id: "EURC-USDC",
                status: "offline",
                status_message: "maintenance"
              }
            ]
          }
        ]
      },
      receivedBase + 5
    );
    expect(eventTypes(stopped)).toEqual([
      "market_status",
      "feed_status"
    ]);
    expect(stopped[1]).toMatchObject({
      payload: {
        state: "stopped",
        eligibleForResearch: false,
        reason: "market_status_offline"
      }
    });

    const recovered = adapter.ingest(
      {
        ...coinbaseStatusSnapshot,
        sequence_num: 5,
        events: [
          {
            type: "update",
            products: [
              {
                id: "EURC-USDC",
                status: "online",
                status_message: ""
              }
            ]
          }
        ]
      },
      receivedBase + 6
    );
    expect(recovered[1]).toMatchObject({
      payload: { state: "healthy", eligibleForResearch: true }
    });
  });

  it("rejects a repeated trade snapshot in one connection", () => {
    const adapter = newAdapter();
    initialize(adapter);

    const repeated = adapter.ingest(
      { ...coinbaseTradeSnapshot, sequence_num: 4 },
      receivedBase + 5
    );
    expect(eventTypes(repeated)).toEqual(["feed_status"]);
    expect(repeated[0]).toMatchObject({
      payload: {
        state: "gapped",
        reason: "duplicate_trade_snapshot"
      }
    });
  });

  it("records reconnects and marks the new snapshot as recovery", () => {
    const adapter = newAdapter();
    initialize(adapter);
    const ended = adapter.endConnection(
      receivedBase + 10,
      "test_disconnect"
    );
    expect(ended[0]).toMatchObject({
      payload: { state: "recovering", reason: "test_disconnect" }
    });

    adapter.beginConnection(secondConnectionId, receivedBase + 11);
    const snapshot = adapter.ingest(
      coinbaseLevel2Snapshot,
      receivedBase + 12
    );
    expect(snapshot[0]).toMatchObject({
      eventType: "book_checkpoint",
      connectionId: secondConnectionId,
      payload: { isRecovery: true }
    });
    expect(adapter.diagnostics().reconnectCount).toBe(1);
  });

  it("advances sequence state across supported future channels", () => {
    const adapter = newAdapter();
    adapter.beginConnection(firstConnectionId, receivedBase);

    expect(
      adapter.ingest(
        {
          channel: "future_public_channel",
          timestamp: "2026-08-02T00:53:10Z",
          sequence_num: 0,
          events: []
        },
        receivedBase + 1
      )
    ).toEqual([]);
    expect(
      eventTypes(
        adapter.ingest(
          { ...coinbaseLevel2Snapshot, sequence_num: 1 },
          receivedBase + 2
        )
      )
    ).toEqual(["book_checkpoint", "feed_status"]);
  });

  it("emits a bounded periodic checkpoint without refreshing market time", () => {
    const adapter = newAdapter();
    initialize(adapter);

    expect(adapter.checkpoint(receivedBase + 1_000)).toMatchObject([
      {
        eventType: "book_checkpoint",
        sourceTimestampMs: null,
        receivedTimestampMs: receivedBase + 1_000,
        venueSequence: "3",
        payload: {
          depth: 2,
          isRecovery: false
        }
      }
    ]);
  });
});
