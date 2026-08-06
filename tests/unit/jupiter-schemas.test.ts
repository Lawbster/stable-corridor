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
});

