import { describe, expect, it } from "vitest";

import {
  createJupiterQuoteRequests
} from "../../src/venues/jupiter/constants.js";
import {
  jupiterOrderQuoteSchema
} from "../../src/venues/jupiter/schemas.js";
import { makeJupiterOrderQuote } from "../fixtures/jupiter.js";

describe("Jupiter public quote schema", () => {
  const request = createJupiterQuoteRequests(["1000"])[0]!;

  it("accepts quote-only exact-in responses", () => {
    expect(
      jupiterOrderQuoteSchema.parse(
        makeJupiterOrderQuote(request)
      ).transaction
    ).toBeNull();
  });

  it("rejects responses carrying a transaction or taker", () => {
    const quote = makeJupiterOrderQuote(request);
    expect(
      jupiterOrderQuoteSchema.safeParse({
        ...quote,
        transaction: "base64-transaction"
      }).success
    ).toBe(false);
    expect(
      jupiterOrderQuoteSchema.safeParse({
        ...quote,
        taker: "wallet-address"
      }).success
    ).toBe(false);
  });

  it("accepts observed scientific impact and fractional split routes", () => {
    const quote = makeJupiterOrderQuote(request);
    const route = (
      quote.routePlan as readonly Record<string, unknown>[]
    )[0]!;
    const parsed = jupiterOrderQuoteSchema.parse({
      ...quote,
      priceImpactPct: "2.8e-7",
      routePlan: [
        { ...route, percent: 99.5, bps: 9_950 },
        { ...route, percent: 0.5, bps: 50 }
      ]
    });
    expect(parsed.priceImpactPct).toBe("2.8e-7");
    expect(parsed.routePlan.map((leg) => leg.percent)).toEqual([
      99.5,
      0.5
    ]);
  });
});
