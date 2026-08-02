import { describe, expect, it } from "vitest";

import {
  parseCoinbaseAdvancedEnvelope
} from "../../src/venues/coinbase/schemas.js";
import {
  coinbaseHeartbeat,
  coinbaseLevel2Snapshot,
  coinbaseStatusSnapshot,
  coinbaseTradeSnapshot
} from "../fixtures/coinbase.js";

describe("Coinbase Advanced Trade public message schemas", () => {
  it("parses recorded level2, trade, and heartbeat fixtures", () => {
    expect(
      parseCoinbaseAdvancedEnvelope(coinbaseLevel2Snapshot).channel
    ).toBe("l2_data");
    expect(parseCoinbaseAdvancedEnvelope(coinbaseTradeSnapshot).channel).toBe(
      "market_trades"
    );
    expect(parseCoinbaseAdvancedEnvelope(coinbaseHeartbeat).channel).toBe(
      "heartbeats"
    );
    expect(
      parseCoinbaseAdvancedEnvelope(coinbaseStatusSnapshot).channel
    ).toBe("status");
  });

  it("parses JSON text and ignores a future unknown channel", () => {
    const parsed = parseCoinbaseAdvancedEnvelope(
      JSON.stringify({
        channel: "future_public_channel",
        timestamp: "2026-08-02T00:53:12Z",
        sequence_num: 9,
        events: [{ future: true }]
      })
    );

    expect(parsed.channel).toBe("future_public_channel");
    expect(parsed.sequence_num).toBe(9);
  });

  it("rejects malformed JSON and malformed known messages", () => {
    expect(() => parseCoinbaseAdvancedEnvelope("{")).toThrow(
      /Invalid Coinbase JSON frame/u
    );
    expect(() =>
      parseCoinbaseAdvancedEnvelope({
        ...coinbaseLevel2Snapshot,
        events: [
          {
            ...coinbaseLevel2Snapshot.events[0],
            updates: [
              {
                ...coinbaseLevel2Snapshot.events[0].updates[0],
                side: "ask"
              }
            ]
          }
        ]
      })
    ).toThrow();
  });
});
