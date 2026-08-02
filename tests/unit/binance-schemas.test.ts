import { describe, expect, it } from "vitest";

import {
  binanceDepthSnapshotSchema,
  binanceExchangeInfoSchema,
  parseBinanceCombinedStream
} from "../../src/venues/binance/schemas.js";
import {
  binanceDepthSnapshot,
  binanceDepthUpdate,
  binanceExchangeInfo,
  binanceTrade
} from "../fixtures/binance.js";

describe("Binance public schemas", () => {
  it("parses recorded depth, trade, snapshot, and metadata payloads", () => {
    expect(parseBinanceCombinedStream(binanceDepthUpdate).data.e).toBe(
      "depthUpdate"
    );
    expect(parseBinanceCombinedStream(JSON.stringify(binanceTrade)).data.e).toBe(
      "trade"
    );
    expect(
      binanceDepthSnapshotSchema.parse(binanceDepthSnapshot).lastUpdateId
    ).toBe(190295610);
    expect(binanceExchangeInfoSchema.parse(binanceExchangeInfo).symbols).toHaveLength(
      3
    );
  });

  it("rejects invalid JSON, sequence ranges, empty deltas, and products", () => {
    expect(() => parseBinanceCombinedStream("{")).toThrow(
      /Invalid Binance JSON frame/u
    );
    expect(() =>
      parseBinanceCombinedStream({
        ...binanceDepthUpdate,
        data: {
          ...binanceDepthUpdate.data,
          U: 20,
          u: 19
        }
      })
    ).toThrow(/first update ID exceeds/u);
    expect(() =>
      parseBinanceCombinedStream({
        ...binanceDepthUpdate,
        data: { ...binanceDepthUpdate.data, b: [], a: [] }
      })
    ).toThrow(/contains no changes/u);
    expect(() =>
      parseBinanceCombinedStream({
        ...binanceTrade,
        data: { ...binanceTrade.data, s: "BTCUSDT" }
      })
    ).toThrow();
  });

  it("accepts a bounded future public event without treating it as data", () => {
    expect(
      parseBinanceCombinedStream({
        stream: "future",
        data: { e: "futurePublicEvent", value: 1 }
      }).data.e
    ).toBe("futurePublicEvent");
  });
});
