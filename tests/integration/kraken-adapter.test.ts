import { describe, expect, it } from "vitest";

import type { NormalizedEvent } from "../../src/collector/schema/events.js";
import { KrakenPublicAdapter } from "../../src/venues/kraken/adapter.js";
import {
  krakenAssetPairs,
  krakenBookSnapshotRaw,
  krakenBookSubscriptionAck,
  krakenBookUpdateRaw,
  krakenHeartbeat,
  krakenStatus,
  krakenTradeRaw,
  krakenTradeSubscriptionAck
} from "../fixtures/kraken.js";

const collectorRunId = "11111111-1111-4111-8111-111111111111";
const firstConnectionId = "22222222-2222-4222-8222-222222222222";
const secondConnectionId = "33333333-3333-4333-8333-333333333333";
const receivedBase =
  Date.parse("2026-08-02T14:19:20.000000Z");

function newAdapter(): KrakenPublicAdapter {
  return new KrakenPublicAdapter({
    products: ["USDC/USD"],
    collectorRunId,
    depth: 25,
    maxRecentTradeIds: 100,
    staleAfterMs: 60_000
  });
}

function eventTypes(events: readonly NormalizedEvent[]): readonly string[] {
  return events.map((event) => event.eventType);
}

function initialize(adapter: KrakenPublicAdapter): void {
  adapter.beginConnection(firstConnectionId, receivedBase);
  adapter.ingestAssetPairs(krakenAssetPairs, receivedBase + 1);
  adapter.ingest(krakenStatus, receivedBase + 2);
  adapter.ingest(krakenBookSubscriptionAck, receivedBase + 3);
  adapter.ingest(krakenTradeSubscriptionAck, receivedBase + 4);
  adapter.ingest(krakenBookSnapshotRaw, receivedBase + 5);
}

describe("Kraken public adapter", () => {
  it("becomes healthy from metadata, system status, acks, and checksum-valid snapshot", () => {
    const adapter = newAdapter();
    const connecting = adapter.beginConnection(
      firstConnectionId,
      receivedBase
    );
    expect(connecting[0]).toMatchObject({
      venue: "kraken",
      product: "USDC-USD",
      nativeProduct: "USDC/USD",
      payload: {
        state: "connecting",
        eligibleForResearch: false
      }
    });
    const metadata = adapter.ingestAssetPairs(
      krakenAssetPairs,
      receivedBase + 1
    );
    expect(eventTypes(metadata)).toEqual(["instrument", "market_status"]);
    expect(metadata[0]).toMatchObject({
      source: "rest",
      payload: {
        tickSize: "0.0001",
        quantityStep: "0.00000001",
        minimumQuantity: "5",
        minimumNotional: "0.5"
      }
    });
    adapter.ingest(krakenStatus, receivedBase + 2);
    adapter.ingest(krakenBookSubscriptionAck, receivedBase + 3);
    adapter.ingest(krakenTradeSubscriptionAck, receivedBase + 4);
    const ready = adapter.ingest(
      krakenBookSnapshotRaw,
      receivedBase + 5
    );
    expect(eventTypes(ready)).toEqual([
      "book_checkpoint",
      "feed_status"
    ]);
    expect(ready[0]).toMatchObject({
      venueSequence: "1:240008930",
      sourceTimestampMs: Date.parse(
        "2026-08-02T14:18:55.706617Z"
      ),
      payload: {
        bids: expect.arrayContaining([
          { price: "0.9997", quantity: "3458455.09588324" },
          { price: "0.9996", quantity: "121278.21147528" }
        ]),
        asks: expect.arrayContaining([
          { price: "0.9998", quantity: "5764470.90836009" },
          { price: "0.9999", quantity: "511413.23906338" }
        ]),
        depth: 25,
        checksum: "240008930",
        isRecovery: false
      }
    });
    expect(ready[1]).toMatchObject({
      payload: { state: "healthy", eligibleForResearch: true }
    });
    expect(adapter.diagnostics()).toMatchObject({
      systemStatus: "online",
      products: [
        {
          state: "healthy",
          bookReady: true,
          metadataReady: true,
          bookAck: true,
          tradeAck: true,
          tradeSeen: false,
          bookMessageOrdinal: 1,
          checksumMismatchCount: 0
        }
      ]
    });
  });

  it("normalizes checksum-valid absolute updates and taker-side trades", () => {
    const adapter = newAdapter();
    initialize(adapter);
    const delta = adapter.ingest(
      krakenBookUpdateRaw,
      receivedBase + 6
    );
    expect(eventTypes(delta)).toEqual(["book_delta"]);
    expect(delta[0]).toMatchObject({
      venueSequence: "2:3271444979",
      payload: {
        updateSemantics: "absolute",
        firstVenueSequence: "2:3271444979",
        lastVenueSequence: "2:3271444979",
        changes: [
          {
            side: "bid",
            price: "0.9997",
            quantity: "3458427.6800536"
          }
        ]
      }
    });
    const trade = adapter.ingest(krakenTradeRaw, receivedBase + 7);
    expect(eventTypes(trade)).toEqual(["trade"]);
    expect(trade[0]).toMatchObject({
      venueSequence: "22719451",
      payload: {
        tradeId: "22719451",
        price: "0.9997",
        quantity: "2.85085526",
        aggressorSide: "sell"
      }
    });
    expect(adapter.diagnostics().products[0]).toMatchObject({
      tradeSeen: true,
      lastTradeId: "22719451",
      lastGoodVenueSequence: "2:3271444979"
    });
  });

  it("fails closed on checksum mismatch without publishing a delta", () => {
    const adapter = newAdapter();
    initialize(adapter);
    const failed = adapter.ingest(
      krakenBookUpdateRaw.replace(
        '"checksum":3271444979',
        '"checksum":1'
      ),
      receivedBase + 6
    );
    expect(eventTypes(failed)).toEqual(["feed_status"]);
    expect(failed[0]).toMatchObject({
      payload: {
        state: "gapped",
        eligibleForResearch: false,
        reason: "book_checksum_mismatch"
      }
    });
    expect(adapter.diagnostics().products[0]).toMatchObject({
      checksumMismatchCount: 1,
      bookReady: false
    });
  });

  it("fails closed on messages before ack/snapshot and bad subscription contracts", () => {
    const beforeAck = newAdapter();
    beforeAck.beginConnection(firstConnectionId, receivedBase);
    expect(
      beforeAck.ingest(krakenBookSnapshotRaw, receivedBase + 1)[0]
    ).toMatchObject({
      payload: { reason: "book_message_before_subscription_ack" }
    });

    const beforeSnapshot = newAdapter();
    beforeSnapshot.beginConnection(firstConnectionId, receivedBase);
    beforeSnapshot.ingest(
      krakenBookSubscriptionAck,
      receivedBase + 1
    );
    expect(
      beforeSnapshot.ingest(krakenBookUpdateRaw, receivedBase + 2)[0]
    ).toMatchObject({
      payload: { reason: "book_update_before_snapshot" }
    });

    const badAck = newAdapter();
    badAck.beginConnection(firstConnectionId, receivedBase);
    expect(
      badAck.ingest(
        { ...krakenBookSubscriptionAck, req_id: 999 },
        receivedBase + 1
      )[0]
    ).toMatchObject({
      payload: { reason: "subscription_request_id_mismatch" }
    });
  });

  it("fails closed on duplicate and out-of-order trades", () => {
    const duplicate = newAdapter();
    initialize(duplicate);
    duplicate.ingest(krakenTradeRaw, receivedBase + 6);
    expect(
      duplicate.ingest(krakenTradeRaw, receivedBase + 7)[0]
    ).toMatchObject({
      payload: { reason: "trade_id_out_of_order" }
    });

    const snapshot = newAdapter();
    initialize(snapshot);
    expect(
      snapshot.ingest(
        krakenTradeRaw.replace(
          '"type":"update"',
          '"type":"snapshot"'
        ),
        receivedBase + 6
      )[0]
    ).toMatchObject({
      payload: { reason: "unexpected_trade_snapshot" }
    });
  });

  it("tracks heartbeats, staleness, and continuous recovery", () => {
    const adapter = newAdapter();
    initialize(adapter);
    expect(adapter.ingest(krakenHeartbeat, receivedBase + 6)).toEqual([]);
    expect(adapter.diagnostics().heartbeatCount).toBe(1);
    const stale = adapter.checkStaleness(receivedBase + 60_006);
    expect(stale[0]).toMatchObject({
      payload: { state: "stale", eligibleForResearch: false }
    });
    const recovered = adapter.ingest(
      krakenBookUpdateRaw,
      receivedBase + 60_007
    );
    expect(eventTypes(recovered)).toEqual([
      "book_delta",
      "feed_status"
    ]);
    expect(recovered[1]).toMatchObject({
      payload: { state: "healthy", eligibleForResearch: true }
    });
  });

  it("stops on system or pair unavailability and recovers when online", () => {
    const system = newAdapter();
    initialize(system);
    const stopped = system.ingest(
      {
        ...krakenStatus,
        data: [{ ...krakenStatus.data[0], system: "maintenance" }]
      },
      receivedBase + 6
    );
    expect(stopped[0]).toMatchObject({
      payload: {
        state: "stopped",
        reason: "system_status_maintenance"
      }
    });
    expect(
      system.ingest(krakenStatus, receivedBase + 7)[0]
    ).toMatchObject({
      payload: { state: "healthy", eligibleForResearch: true }
    });

    const pair = newAdapter();
    pair.beginConnection(firstConnectionId, receivedBase);
    const offline = pair.ingestAssetPairs(
      {
        ...krakenAssetPairs,
        result: {
          ...krakenAssetPairs.result,
          USDCUSD: {
            ...krakenAssetPairs.result.USDCUSD!,
            status: "maintenance"
          }
        }
      },
      receivedBase + 1
    );
    expect(eventTypes(offline)).toEqual([
      "instrument",
      "market_status",
      "feed_status"
    ]);
    expect(offline[2]).toMatchObject({
      payload: {
        state: "stopped",
        reason: "market_status_offline"
      }
    });
  });

  it("records reconnect recovery and rejects backwards receive time", () => {
    const adapter = newAdapter();
    initialize(adapter);
    adapter.endConnection(receivedBase + 10, "test_disconnect");
    adapter.beginConnection(secondConnectionId, receivedBase + 11);
    adapter.ingestAssetPairs(krakenAssetPairs, receivedBase + 12);
    adapter.ingest(krakenStatus, receivedBase + 13);
    adapter.ingest(krakenBookSubscriptionAck, receivedBase + 14);
    adapter.ingest(krakenTradeSubscriptionAck, receivedBase + 15);
    const recovered = adapter.ingest(
      krakenBookSnapshotRaw,
      receivedBase + 16
    );
    expect(recovered[0]).toMatchObject({
      connectionId: secondConnectionId,
      payload: { isRecovery: true }
    });
    expect(adapter.diagnostics().reconnectCount).toBe(1);

    const backwards = newAdapter();
    backwards.beginConnection(firstConnectionId, receivedBase);
    backwards.ingest(krakenStatus, receivedBase + 2);
    expect(
      backwards.ingest(krakenHeartbeat, receivedBase + 1)[0]
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
          method: "subscribe",
          success: false,
          error: "Unsupported field",
          req_id: 301
        },
        receivedBase + 1
      )[0]
    ).toMatchObject({
      payload: {
        state: "gapped",
        reason: "subscription_failed:Unsupported field"
      }
    });
  });

  it("emits a periodic checkpoint with the last verified checksum", () => {
    const adapter = newAdapter();
    initialize(adapter);
    adapter.ingest(krakenTradeRaw, receivedBase + 6);

    expect(adapter.checkpoint(receivedBase + 1_000)).toMatchObject([
      {
        eventType: "book_checkpoint",
        sourceTimestampMs: null,
        receivedTimestampMs: receivedBase + 1_000,
        venueSequence: "1:240008930",
        payload: {
          depth: 25,
          checksum: "240008930",
          isRecovery: false
        }
      }
    ]);
  });
});
