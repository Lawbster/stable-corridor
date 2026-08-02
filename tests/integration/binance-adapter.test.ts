import { describe, expect, it } from "vitest";

import type { NormalizedEvent } from "../../src/collector/schema/events.js";
import { BinancePublicAdapter } from "../../src/venues/binance/adapter.js";
import {
  binanceDepthSnapshot,
  binanceDepthUpdate,
  binanceExchangeInfoEurUsdc,
  binanceTrade
} from "../fixtures/binance.js";

const collectorRunId = "11111111-1111-4111-8111-111111111111";
const firstConnectionId = "22222222-2222-4222-8222-222222222222";
const secondConnectionId = "33333333-3333-4333-8333-333333333333";
const receivedBase = Date.UTC(2026, 7, 2, 3, 30, 0);

function newAdapter(
  overrides: Partial<{
    readonly maxBufferedDepthEvents: number;
  }> = {}
): BinancePublicAdapter {
  return new BinancePublicAdapter({
    products: ["EURUSDC"],
    collectorRunId,
    depth: 2,
    maxTrackedLevelsPerSide: 100,
    maxBufferedDepthEvents: overrides.maxBufferedDepthEvents ?? 100,
    staleAfterMs: 5_000
  });
}

function eventTypes(events: readonly NormalizedEvent[]): readonly string[] {
  return events.map((event) => event.eventType);
}

function initialize(adapter: BinancePublicAdapter): void {
  adapter.beginConnection(firstConnectionId, receivedBase);
  adapter.ingestExchangeInfo(binanceExchangeInfoEurUsdc, receivedBase + 1);
  adapter.ingest(binanceDepthUpdate, receivedBase + 2);
  adapter.applyDepthSnapshot(
    "EURUSDC",
    binanceDepthSnapshot,
    receivedBase + 3
  );
}

describe("Binance public adapter", () => {
  it("synchronizes buffered depth and becomes healthy without waiting for a trade", () => {
    const adapter = newAdapter();
    const connecting = adapter.beginConnection(
      firstConnectionId,
      receivedBase
    );
    expect(connecting[0]).toMatchObject({
      venue: "binance",
      product: "EUR-USDC",
      nativeProduct: "EURUSDC",
      payload: {
        state: "connecting",
        eligibleForResearch: false
      }
    });

    const metadata = adapter.ingestExchangeInfo(
      binanceExchangeInfoEurUsdc,
      receivedBase + 1
    );
    expect(eventTypes(metadata)).toEqual(["instrument", "market_status"]);
    expect(metadata[0]).toMatchObject({
      source: "rest",
      payload: {
        tickSize: "0.0001",
        quantityStep: "0.1",
        minimumNotional: "5"
      }
    });

    expect(
      adapter.ingest(binanceDepthUpdate, receivedBase + 2)
    ).toEqual([]);
    const synchronized = adapter.applyDepthSnapshot(
      "EURUSDC",
      binanceDepthSnapshot,
      receivedBase + 3
    );
    expect(eventTypes(synchronized)).toEqual([
      "book_checkpoint",
      "feed_status"
    ]);
    expect(synchronized[0]).toMatchObject({
      source: "rest",
      sourceTimestampMs: binanceDepthUpdate.data.E,
      receivedTimestampMs: receivedBase + 3,
      venueSequence: "190295611",
      payload: {
        bids: [
          { price: "1.152", quantity: "31585.4" },
          { price: "1.1519", quantity: "20709.7" }
        ],
        asks: [
          { price: "1.1521", quantity: "8609.2" },
          { price: "1.1522", quantity: "5756.4" }
        ],
        depth: 2,
        isRecovery: false
      }
    });
    expect(synchronized[1]).toMatchObject({
      payload: {
        state: "healthy",
        eligibleForResearch: true
      }
    });
    expect(adapter.diagnostics().products[0]).toMatchObject({
      state: "healthy",
      bookReady: true,
      metadataReady: true,
      tradeSeen: false,
      lastDepthUpdateId: "190295611",
      gapCount: 0
    });
  });

  it("normalizes continuous deltas and aggressor-side trades", () => {
    const adapter = newAdapter();
    initialize(adapter);

    const delta = adapter.ingest(
      {
        ...binanceDepthUpdate,
        data: {
          ...binanceDepthUpdate.data,
          E: binanceDepthUpdate.data.E + 1,
          U: 190295612,
          u: 190295612,
          a: [["1.15220000", "0.00000000"]]
        }
      },
      receivedBase + 4
    );
    expect(eventTypes(delta)).toEqual(["book_delta"]);
    expect(delta[0]).toMatchObject({
      venueSequence: "190295612",
      payload: {
        updateSemantics: "absolute",
        firstVenueSequence: "190295612",
        lastVenueSequence: "190295612",
        changes: [
          { side: "ask", price: "1.1522", quantity: "0" }
        ]
      }
    });

    const buy = adapter.ingest(binanceTrade, receivedBase + 5);
    expect(eventTypes(buy)).toEqual(["trade"]);
    expect(buy[0]).toMatchObject({
      venueSequence: "27369602",
      payload: {
        tradeId: "27369602",
        price: "1.1521",
        quantity: "72.4",
        aggressorSide: "buy"
      }
    });
    const sell = adapter.ingest(
      {
        ...binanceTrade,
        data: {
          ...binanceTrade.data,
          t: 27369603,
          m: true
        }
      },
      receivedBase + 6
    );
    expect(sell[0]).toMatchObject({
      payload: { aggressorSide: "sell" }
    });
  });

  it("requests a newer snapshot without discarding a continuous buffer", () => {
    const adapter = newAdapter();
    adapter.beginConnection(firstConnectionId, receivedBase);
    adapter.ingestExchangeInfo(
      binanceExchangeInfoEurUsdc,
      receivedBase + 1
    );
    adapter.ingest(
      {
        ...binanceDepthUpdate,
        data: {
          ...binanceDepthUpdate.data,
          U: 190295700,
          u: 190295700
        }
      },
      receivedBase + 2
    );

    const retry = adapter.applyDepthSnapshot(
      "EURUSDC",
      binanceDepthSnapshot,
      receivedBase + 3
    );
    expect(retry[0]).toMatchObject({
      payload: {
        state: "recovering",
        eligibleForResearch: false,
        reason: "snapshot_too_old:190295610->190295700"
      }
    });
    expect(adapter.diagnostics().products[0]).toMatchObject({
      bufferedDepthEvents: 1,
      snapshotRetryCount: 1,
      state: "recovering"
    });

    const recovered = adapter.applyDepthSnapshot(
      "EURUSDC",
      { ...binanceDepthSnapshot, lastUpdateId: 190295699 },
      receivedBase + 4
    );
    expect(eventTypes(recovered)).toEqual([
      "book_checkpoint",
      "feed_status"
    ]);
    expect(recovered[0]?.venueSequence).toBe("190295700");
    expect(recovered[1]).toMatchObject({
      payload: { state: "healthy", eligibleForResearch: true }
    });
  });

  it("fails closed on depth gaps, trade gaps, malformed frames, and buffer overflow", () => {
    const depthGap = newAdapter();
    initialize(depthGap);
    expect(
      depthGap.ingest(
        {
          ...binanceDepthUpdate,
          data: {
            ...binanceDepthUpdate.data,
            U: 190295613,
            u: 190295613
          }
        },
        receivedBase + 4
      )[0]
    ).toMatchObject({
      payload: {
        state: "gapped",
        reason: "depth_sequence_gap:190295611->190295613"
      }
    });

    const tradeGap = newAdapter();
    initialize(tradeGap);
    tradeGap.ingest(binanceTrade, receivedBase + 4);
    expect(
      tradeGap.ingest(
        {
          ...binanceTrade,
          data: { ...binanceTrade.data, t: 27369604 }
        },
        receivedBase + 5
      )[0]
    ).toMatchObject({
      payload: {
        state: "gapped",
        reason: "trade_id_gap:27369602->27369604"
      }
    });

    const malformed = newAdapter();
    malformed.beginConnection(firstConnectionId, receivedBase);
    expect(malformed.ingest("{", receivedBase + 1)[0]).toMatchObject({
      payload: { state: "gapped" }
    });

    const unconfigured = newAdapter();
    unconfigured.beginConnection(firstConnectionId, receivedBase);
    expect(
      unconfigured.ingest(
        {
          ...binanceDepthUpdate,
          stream: "euriusdc@depth@100ms",
          data: {
            ...binanceDepthUpdate.data,
            s: "EURIUSDC"
          }
        },
        receivedBase + 1
      )[0]
    ).toMatchObject({
      payload: {
        state: "gapped",
        reason: "unconfigured_product:EURIUSDC"
      }
    });

    const bounded = newAdapter({ maxBufferedDepthEvents: 1 });
    bounded.beginConnection(firstConnectionId, receivedBase);
    bounded.ingest(binanceDepthUpdate, receivedBase + 1);
    expect(
      bounded.ingest(
        {
          ...binanceDepthUpdate,
          data: {
            ...binanceDepthUpdate.data,
            U: 190295612,
            u: 190295612
          }
        },
        receivedBase + 2
      )[0]
    ).toMatchObject({
      payload: { state: "gapped", reason: "depth_buffer_limit" }
    });
  });

  it("rejects crossed books without publishing an invalid delta", () => {
    const adapter = newAdapter();
    initialize(adapter);
    const result = adapter.ingest(
      {
        ...binanceDepthUpdate,
        data: {
          ...binanceDepthUpdate.data,
          U: 190295612,
          u: 190295612,
          b: [["1.15210000", "1.00000000"]],
          a: []
        }
      },
      receivedBase + 4
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

  it("marks quiet products stale and recovers on a continuous trade", () => {
    const adapter = newAdapter();
    initialize(adapter);

    const stale = adapter.checkStaleness(receivedBase + 5_004);
    expect(stale[0]).toMatchObject({
      payload: { state: "stale", eligibleForResearch: false }
    });
    const recovered = adapter.ingest(binanceTrade, receivedBase + 5_005);
    expect(eventTypes(recovered)).toEqual(["trade", "feed_status"]);
    expect(recovered[1]).toMatchObject({
      payload: { state: "healthy", eligibleForResearch: true }
    });
  });

  it("keeps unavailable metadata ineligible until a later public refresh", () => {
    const adapter = newAdapter();
    adapter.beginConnection(firstConnectionId, receivedBase);
    const stopped = adapter.ingestExchangeInfo(
      {
        ...binanceExchangeInfoEurUsdc,
        symbols: [
          {
            ...binanceExchangeInfoEurUsdc.symbols[0],
            status: "BREAK"
          }
        ]
      },
      receivedBase + 1
    );
    expect(eventTypes(stopped)).toEqual([
      "instrument",
      "market_status",
      "feed_status"
    ]);
    expect(stopped[2]).toMatchObject({
      payload: {
        state: "stopped",
        eligibleForResearch: false,
        reason: "market_status_offline"
      }
    });

    adapter.ingest(binanceDepthUpdate, receivedBase + 2);
    expect(
      eventTypes(
        adapter.applyDepthSnapshot(
          "EURUSDC",
          binanceDepthSnapshot,
          receivedBase + 3
        )
      )
    ).toEqual(["book_checkpoint"]);
    const online = adapter.ingestExchangeInfo(
      binanceExchangeInfoEurUsdc,
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

  it("records reconnect recovery and rejects backwards receive time", () => {
    const adapter = newAdapter();
    initialize(adapter);
    adapter.endConnection(receivedBase + 10, "test_disconnect");
    adapter.beginConnection(secondConnectionId, receivedBase + 11);
    adapter.ingestExchangeInfo(
      binanceExchangeInfoEurUsdc,
      receivedBase + 12
    );
    adapter.ingest(binanceDepthUpdate, receivedBase + 13);
    const checkpoint = adapter.applyDepthSnapshot(
      "EURUSDC",
      binanceDepthSnapshot,
      receivedBase + 14
    );
    expect(checkpoint[0]).toMatchObject({
      connectionId: secondConnectionId,
      payload: { isRecovery: true }
    });
    expect(adapter.diagnostics().reconnectCount).toBe(1);

    const backwards = newAdapter();
    backwards.beginConnection(firstConnectionId, receivedBase);
    backwards.ingestExchangeInfo(
      binanceExchangeInfoEurUsdc,
      receivedBase + 2
    );
    expect(
      backwards.ingest(binanceDepthUpdate, receivedBase + 1)[0]
    ).toMatchObject({
      payload: {
        state: "gapped",
        reason: "receive_timestamp_moved_backwards"
      }
    });
  });
});
