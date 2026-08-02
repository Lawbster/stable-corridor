import { describe, expect, it } from "vitest";

import {
  krakenBookMessageSchema,
  parseKrakenPublicMessage
} from "../../src/venues/kraken/schemas.js";
import {
  krakenBookSnapshotRaw,
  krakenBookSubscriptionAck,
  krakenBookUpdateRaw,
  krakenHeartbeat,
  krakenStatus,
  krakenTradeRaw
} from "../fixtures/kraken.js";

describe("Kraken public schemas", () => {
  it("preserves exact price and quantity lexemes from v2 frames", () => {
    const snapshot = krakenBookMessageSchema.parse(
      parseKrakenPublicMessage(krakenBookSnapshotRaw)
    );
    expect(snapshot.data[0]!.bids[3]).toEqual({
      price: "0.9994",
      qty: "1050.02601480"
    });
    expect(snapshot.data[0]!.asks[2]).toEqual({
      price: "1.0000",
      qty: "2019643.00338220"
    });
    expect(
      parseKrakenPublicMessage(krakenBookUpdateRaw)
    ).toMatchObject({ channel: "book", type: "update" });
    expect(parseKrakenPublicMessage(krakenTradeRaw)).toMatchObject({
      channel: "trade",
      data: [{ trade_id: 22719451, qty: "2.85085526" }]
    });
  });

  it("routes subscription, status, heartbeat, and unknown messages", () => {
    expect(
      parseKrakenPublicMessage(krakenBookSubscriptionAck)
    ).toEqual(krakenBookSubscriptionAck);
    expect(parseKrakenPublicMessage(krakenStatus)).toMatchObject({
      channel: "status",
      data: [{ system: "online" }]
    });
    expect(parseKrakenPublicMessage(krakenHeartbeat)).toEqual({
      channel: "heartbeat"
    });
    expect(
      parseKrakenPublicMessage({
        channel: "ticker",
        type: "update",
        data: []
      })
    ).toEqual({ channel: "ticker", type: "update", data: [] });
  });

  it("rejects malformed, unsupported-product, and empty updates", () => {
    expect(() => parseKrakenPublicMessage("{")).toThrow(
      /Invalid Kraken JSON frame/u
    );
    expect(() =>
      parseKrakenPublicMessage(
        krakenBookUpdateRaw.replace("USDC/USD", "BTC/USD")
      )
    ).toThrow();
    expect(() =>
      parseKrakenPublicMessage(
        '{"channel":"book","type":"update","data":[{"symbol":"USDC/USD","bids":[],"asks":[],"checksum":1,"timestamp":"2026-08-02T14:18:59.179906Z"}]}'
      )
    ).toThrow(/contains no changes/u);
  });
});
