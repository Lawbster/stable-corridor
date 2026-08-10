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

  it("prioritizes three bounded anomaly follow-ups before resuming the sweep", async () => {
    const request = createJupiterQuoteRequests(["1000"])[0]!;
    const contexts: unknown[] = [];
    let clock = 1_700_000_000_000;
    let session: JupiterPublicQuoteSession;
    session = new JupiterPublicQuoteSession({
      inputAmounts: ["1000"],
      minimumRequestIntervalMs: 2_000,
      retryDelayMs: 5_000,
      requestTimeoutMs: 10_000,
      maxResponseBytes: 262_144,
      now: () => {
        clock += 2_000;
        return clock;
      },
      fetchImplementation: async () =>
        new Response(JSON.stringify(makeJupiterOrderQuote(request)), {
          status: 200,
          headers: { "content-type": "application/json" }
        }),
      onQuote: (_request, _response, _started, _received, context) => {
        contexts.push(context);
        if (contexts.length === 1) {
          session.scheduleAnomalyFollowUps(
            request,
            "trigger-request",
            3
          );
        } else if (contexts.length === 4) {
          session.stop();
        }
      },
      onFailure: () => {
        throw new Error("unexpected failure");
      }
    });

    session.start();
    await session.drain();

    expect(contexts).toEqual([
      { kind: "baseline" },
      {
        kind: "anomaly_follow_up",
        triggerRequestId: "trigger-request",
        followUpIndex: 1
      },
      {
        kind: "anomaly_follow_up",
        triggerRequestId: "trigger-request",
        followUpIndex: 2
      },
      {
        kind: "anomaly_follow_up",
        triggerRequestId: "trigger-request",
        followUpIndex: 3
      }
    ]);
  });
});
