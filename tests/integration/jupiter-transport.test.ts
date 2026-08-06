import { describe, expect, it } from "vitest";

import {
  createJupiterQuoteRequests
} from "../../src/venues/jupiter/constants.js";
import {
  createJupiterOrderUrl,
  JupiterPublicQuoteSession
} from "../../src/venues/jupiter/transport.js";
import { makeJupiterOrderQuote } from "../fixtures/jupiter.js";

describe("Jupiter public quote transport", () => {
  it("builds a quote-only URL with exactly three parameters", () => {
    const request = createJupiterQuoteRequests(["1000"])[0]!;
    const url = new URL(createJupiterOrderUrl(request));
    expect([...url.searchParams.keys()].sort()).toEqual([
      "amount",
      "inputMint",
      "outputMint"
    ]);
    expect(url.searchParams.has("taker")).toBe(false);
  });

  it("delivers a bounded public response and stops cleanly", async () => {
    const request = createJupiterQuoteRequests(["1000"])[0]!;
    let session: JupiterPublicQuoteSession;
    let observed = 0;
    session = new JupiterPublicQuoteSession({
      inputAmounts: ["1000"],
      minimumRequestIntervalMs: 2_000,
      retryDelayMs: 5_000,
      requestTimeoutMs: 10_000,
      maxResponseBytes: 262_144,
      fetchImplementation: async () =>
        new Response(
          JSON.stringify(makeJupiterOrderQuote(request)),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        ),
      onQuote: () => {
        observed += 1;
        session.stop();
      },
      onFailure: () => {
        throw new Error("unexpected failure");
      }
    });
    session.start();
    await session.drain();
    expect(observed).toBe(1);
  });
});

