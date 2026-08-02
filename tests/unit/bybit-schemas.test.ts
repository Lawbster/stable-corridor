import { describe, expect, it } from "vitest";

import {
  bybitOrderbookMessageSchema,
  parseBybitPublicMessage
} from "../../src/venues/bybit/schemas.js";
import {
  bybitOrderbookDelta,
  bybitOrderbookSnapshot,
  bybitPong,
  bybitPublicTrade,
  bybitSubscriptionAck
} from "../fixtures/bybit.js";

describe("Bybit public schemas", () => {
  it("routes the supported public frames", () => {
    expect(parseBybitPublicMessage(bybitOrderbookSnapshot)).toEqual(
      bybitOrderbookSnapshot
    );
    expect(parseBybitPublicMessage(JSON.stringify(bybitPublicTrade))).toEqual(
      bybitPublicTrade
    );
    expect(parseBybitPublicMessage(bybitSubscriptionAck)).toEqual(
      bybitSubscriptionAck
    );
    expect(parseBybitPublicMessage(bybitPong)).toEqual(bybitPong);
  });

  it("safely ignores structurally valid unknown public messages", () => {
    expect(
      parseBybitPublicMessage({
        topic: "tickers.USDCUSDT",
        type: "snapshot",
        data: {}
      })
    ).toEqual({
      topic: "tickers.USDCUSDT",
      type: "snapshot",
      data: {}
    });
  });

  it("rejects malformed, unsupported-product, and empty delta frames", () => {
    expect(() => parseBybitPublicMessage("{")).toThrow(
      /Invalid Bybit JSON frame/u
    );
    expect(
      bybitOrderbookMessageSchema.safeParse({
        ...bybitOrderbookDelta,
        data: { ...bybitOrderbookDelta.data, b: [], a: [] }
      }).success
    ).toBe(false);
    expect(() =>
      parseBybitPublicMessage({
        ...bybitOrderbookSnapshot,
        data: { ...bybitOrderbookSnapshot.data, s: "BTCUSDT" }
      })
    ).toThrow();
  });
});
