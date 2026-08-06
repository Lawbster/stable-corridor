import { describe, expect, it } from "vitest";

import { JupiterPublicAdapter } from "../../src/venues/jupiter/adapter.js";
import {
  createJupiterQuoteRequests
} from "../../src/venues/jupiter/constants.js";
import { makeJupiterOrderQuote } from "../fixtures/jupiter.js";

const collectorRunId = "11111111-1111-4111-8111-111111111111";
const connectionId = "22222222-2222-4222-8222-222222222222";

describe("Jupiter public adapter", () => {
  it("becomes eligible only after the approved four-quote sweep", () => {
    const adapter = new JupiterPublicAdapter({
      collectorRunId,
      inputAmounts: ["1000", "10000"],
      staleAfterMs: 30_000
    });
    expect(
      adapter.beginConnection(connectionId, 1_700_000_000_000)[0]
        ?.payload.state
    ).toBe("connecting");

    const requests = createJupiterQuoteRequests(["1000", "10000"]);
    for (let index = 0; index < requests.length; index += 1) {
      const request = requests[index]!;
      const events = adapter.ingestQuote({
        request,
        response: makeJupiterOrderQuote(request, {
          requestId: `request-${index}`
        }),
        requestStartedAtMs: 1_700_000_000_100 + index * 100,
        receivedTimestampMs: 1_700_000_000_150 + index * 100
      });
      expect(events[0]?.eventType).toBe("dex_quote");
      if (index < requests.length - 1) {
        expect(events).toHaveLength(1);
      } else {
        expect(events[1]?.eventType).toBe("feed_status");
        if (events[1]?.eventType === "feed_status") {
          expect(events[1].payload.eligibleForResearch).toBe(true);
        }
      }
    }
    expect(adapter.diagnostics().state).toBe("healthy");
  });

  it("rejects a response for a different approved request", () => {
    const adapter = new JupiterPublicAdapter({
      collectorRunId,
      inputAmounts: ["1000", "10000"],
      staleAfterMs: 30_000
    });
    adapter.beginConnection(connectionId, 1_700_000_000_000);
    const [first, second] = createJupiterQuoteRequests(["1000"]);
    expect(() =>
      adapter.ingestQuote({
        request: first!,
        response: makeJupiterOrderQuote(second!),
        requestStartedAtMs: 1_700_000_000_100,
        receivedTimestampMs: 1_700_000_000_200
      })
    ).toThrow(/did not match/iu);
  });

  it("normalizes observed Jupiter response variants", () => {
    const adapter = new JupiterPublicAdapter({
      collectorRunId,
      inputAmounts: ["1000", "10000"],
      staleAfterMs: 30_000
    });
    adapter.beginConnection(connectionId, 1_700_000_000_000);
    const request = createJupiterQuoteRequests(["1000"])[0]!;
    const base = makeJupiterOrderQuote(request);
    const route = (
      base.routePlan as readonly Record<string, unknown>[]
    )[0]!;
    const event = adapter.ingestQuote({
      request,
      response: makeJupiterOrderQuote(request, {
        priceImpactPct: "-2.8e-7",
        routePlan: [
          { ...route, percent: 99.5, bps: 9_950 },
          { ...route, percent: 0.5, bps: 50 }
        ]
      }),
      requestStartedAtMs: 1_700_000_000_100,
      receivedTimestampMs: 1_700_000_000_200
    })[0]!;

    expect(event.eventType).toBe("dex_quote");
    if (event.eventType === "dex_quote") {
      expect(event.payload.priceImpactPct).toBe("-0.00000028");
      expect(
        event.payload.routePlan.map((leg) => leg.percentBps)
      ).toEqual([9_950, 50]);
    }
  });

  it("emits stopped status before deactivation and can reconnect", () => {
    const adapter = new JupiterPublicAdapter({
      collectorRunId,
      inputAmounts: ["1000", "10000"],
      staleAfterMs: 30_000
    });
    adapter.beginConnection(connectionId, 1_700_000_000_000);
    expect(
      adapter.checkStaleness(1_700_000_030_001)[0]?.payload.state
    ).toBe("stale");
    const stopped = adapter.endConnection(
      1_700_000_030_002,
      "feed_recovery_required"
    );
    expect(stopped[0]?.payload.state).toBe("stopped");
    expect(adapter.diagnostics().active).toBe(false);

    adapter.beginConnection(
      "33333333-3333-4333-8333-333333333333",
      1_700_000_035_002
    );
    expect(adapter.diagnostics().reconnectCount).toBe(1);
    expect(adapter.diagnostics().state).toBe("connecting");
  });
});
