import { describe, expect, it } from "vitest";

import {
  bookDeltaEventSchema,
  cexDexProbeEventSchema,
  dexQuoteEventSchema,
  feedStatusEventSchema,
  type NormalizedEvent
} from "../../src/collector/schema/events.js";
import {
  scanCoinbaseJupiterQuotes
} from "../../src/opportunity/cex-dex-scan.js";
import type { ReplayPosition } from "../../src/replay/order.js";
import {
  JUPITER_ASSETS
} from "../../src/venues/jupiter/constants.js";
import { makeBookCheckpointEvent } from "../fixtures/events.js";

const collectorRunId = "11111111-1111-4111-8111-111111111111";
const connectionId = "22222222-2222-4222-8222-222222222222";
const startedAtMs = 1_700_000_000_000;

function envelope(
  venue: string,
  receivedTimestampMs: number,
  ingestSequence: number
) {
  return {
    schemaVersion: 1 as const,
    venue,
    product: "EURC-USDC",
    nativeProduct: "EURC-USDC",
    sourceTimestampMs: null,
    receivedTimestampMs,
    ingestSequence,
    collectorRunId,
    connectionId,
    venueSequence: String(ingestSequence),
    source: venue === "jupiter" ? ("rest" as const) : ("websocket" as const)
  };
}

function healthyFeed(receivedTimestampMs: number): NormalizedEvent {
  return feedStatusEventSchema.parse({
    ...envelope("coinbase", receivedTimestampMs, 2),
    eventType: "feed_status",
    payload: {
      state: "healthy",
      eligibleForResearch: true,
      reason: null,
      lastGoodVenueSequence: "1",
      observedAtMs: receivedTimestampMs
    }
  });
}

function quote(
  receivedTimestampMs: number,
  outputAmount: string,
  ingestSequence: number,
  probe?:
    | { readonly kind: "baseline" }
    | {
        readonly kind: "anomaly_follow_up";
        readonly triggerRequestId: string;
        readonly followUpIndex: number;
      }
): NormalizedEvent {
  const outputAmountAtomic = (
    BigInt(outputAmount) * 1_000_000n
  ).toString();
  return dexQuoteEventSchema.parse({
    ...envelope("jupiter", receivedTimestampMs, ingestSequence),
    eventType: "dex_quote",
    payload: {
      quoteKind: "exact_in",
      inputAsset: "USDC",
      outputAsset: "EURC",
      inputMint: JUPITER_ASSETS.USDC.mint,
      outputMint: JUPITER_ASSETS.EURC.mint,
      inputDecimals: 6,
      outputDecimals: 6,
      inputAmountAtomic: "1000000000",
      outputAmountAtomic,
      minimumOutputAmountAtomic: outputAmountAtomic,
      inputAmount: "1000",
      outputAmount,
      minimumOutputAmount: outputAmount,
      requestStartedAtMs: receivedTimestampMs - 50,
      quoteLatencyMs: 50,
      providerProcessingMs: 40,
      slippageBps: 0,
      feeBps: 0,
      platformFeeBps: 0,
      priceImpactPct: "0",
      signatureFeeLamports: 0,
      prioritizationFeeLamports: 0,
      rentFeeLamports: 0,
      router: "jupiterz",
      swapType: "rfq",
      gasless: true,
      guaranteedPrice: true,
      requestId: `request-${ingestSequence}`,
      quoteId: null,
      ...(probe === undefined ? {} : { probe }),
      routePlan: [
        {
          ammKey: "test-amm",
          label: "JupiterZ",
          inputMint: JUPITER_ASSETS.USDC.mint,
          outputMint: JUPITER_ASSETS.EURC.mint,
          inputAmountAtomic: "1000000000",
          outputAmountAtomic,
          percentBps: 10_000
        }
      ]
    }
  });
}

function position(event: NormalizedEvent, lineNumber: number): ReplayPosition {
  return {
    event,
    journalId: `journal-${lineNumber}`,
    lineNumber
  };
}

async function* positions(
  events: readonly NormalizedEvent[]
): AsyncGenerator<ReplayPosition> {
  for (let index = 0; index < events.length; index += 1) {
    yield position(events[index]!, index + 1);
  }
}

describe("Coinbase/Jupiter replay screen", () => {
  it("uses the Coinbase book known when each quote is received", async () => {
    const checkpoint = makeBookCheckpointEvent({
      collectorRunId,
      connectionId,
      receivedTimestampMs: startedAtMs + 100,
      bidPrice: "1.12",
      askPrice: "1.121",
      bidQuantity: "2000",
      askQuantity: "2000"
    });
    const firstQuote = quote(startedAtMs + 200, "900", 3);
    const delta = bookDeltaEventSchema.parse({
      ...envelope("coinbase", startedAtMs + 300, 4),
      eventType: "book_delta",
      payload: {
        updateSemantics: "absolute",
        firstVenueSequence: "4",
        lastVenueSequence: "4",
        changes: [
          { side: "bid", price: "1.12", quantity: "0" },
          { side: "bid", price: "1.1", quantity: "2000" }
        ]
      }
    });
    const secondQuote = quote(startedAtMs + 2_400, "900", 5);
    const report = await scanCoinbaseJupiterQuotes(
      positions([
        checkpoint,
        healthyFeed(startedAtMs + 110),
        firstQuote,
        delta,
        secondQuote
      ]),
      {
        collectorRunId,
        minimumSamplesPerRouteSize: 0,
        minimumObservationHours: 0
      }
    );

    expect(report.observations.eligibleComparisons).toBe(2);
    const route =
      report.byRouteSize[
        "buy_eurc_jupiter_sell_coinbase|1000"
      ]!;
    expect(route.grossEdgeBps.maximum).toBeCloseTo(80);
    expect(route.grossEdgeBps.minimum).toBeCloseTo(-100);
    expect(report.largestModeledEdges).toHaveLength(2);
    expect(report.largestModeledEdges[0]).toMatchObject({
      direction: "buy_eurc_jupiter_sell_coinbase",
      inputAmount: "1000",
      receivedTimestampMs: startedAtMs + 200
    });
    expect(report.sampledPersistence.evaluatedStarts).toBe(1);
    expect(report.sampledPersistence.confirmedAtNextQuote).toBe(0);
  });

  it("summarizes sample sets larger than the variadic argument limit", async () => {
    const checkpoint = makeBookCheckpointEvent({
      collectorRunId,
      connectionId,
      receivedTimestampMs: startedAtMs + 100,
      bidPrice: "1.12",
      askPrice: "1.121",
      bidQuantity: "2000",
      askQuantity: "2000"
    });
    const repeatedQuote = quote(startedAtMs + 200, "900", 3);
    const sampleCount = 150_000;
    async function* largeSample(): AsyncGenerator<ReplayPosition> {
      yield position(checkpoint, 1);
      yield position(healthyFeed(startedAtMs + 110), 2);
      for (let index = 0; index < sampleCount; index += 1) {
        yield position(repeatedQuote, index + 3);
      }
    }

    const report = await scanCoinbaseJupiterQuotes(largeSample(), {
      collectorRunId,
      minimumSamplesPerRouteSize: 0,
      minimumObservationHours: 0
    });

    expect(report.observations.eligibleComparisons).toBe(sampleCount);
    const gross =
      report.byRouteSize[
        "buy_eurc_jupiter_sell_coinbase|1000"
      ]!.grossEdgeBps;
    expect(gross.minimum).toBeCloseTo(80);
    expect(gross.maximum).toBeCloseTo(80);
  });

  it("reports explicitly linked anomaly follow-ups without skewing baseline distributions", async () => {
    const checkpoint = makeBookCheckpointEvent({
      collectorRunId,
      connectionId,
      receivedTimestampMs: startedAtMs + 100,
      bidPrice: "1.12",
      askPrice: "1.121",
      bidQuantity: "2000",
      askQuantity: "2000"
    });
    const triggerQuote = quote(
      startedAtMs + 200,
      "900",
      3,
      { kind: "baseline" }
    );
    const probe = cexDexProbeEventSchema.parse({
      ...envelope("jupiter", startedAtMs + 200, 4),
      source: "derived",
      eventType: "cex_dex_probe",
      payload: {
        probeId: "request-3",
        triggerRequestId: "request-3",
        direction: "buy_eurc_jupiter_sell_coinbase",
        inputAmount: "1000",
        router: "jupiterz",
        triggerReceivedTimestampMs: startedAtMs + 200,
        grossEdgeBps: "80",
        modeledNetEdgeBps: "77.9",
        capitalUsdc: "1000",
        followUpCount: 3,
        minimumRequestIntervalMs: 2_100,
        model: {
          coinbaseFeeBps: "0.1",
          modeledNetworkFeeUsdc: "0.01",
          executionBufferBps: "2",
          decisionThresholdBps: "3"
        }
      }
    });
    const followUps = [
      quote(startedAtMs + 2_300, "900", 5, {
        kind: "anomaly_follow_up",
        triggerRequestId: "request-3",
        followUpIndex: 1
      }),
      quote(startedAtMs + 4_400, "880", 6, {
        kind: "anomaly_follow_up",
        triggerRequestId: "request-3",
        followUpIndex: 2
      }),
      quote(startedAtMs + 6_500, "900", 7, {
        kind: "anomaly_follow_up",
        triggerRequestId: "request-3",
        followUpIndex: 3
      })
    ];

    const report = await scanCoinbaseJupiterQuotes(
      positions([
        checkpoint,
        healthyFeed(startedAtMs + 110),
        triggerQuote,
        probe,
        ...followUps
      ]),
      {
        collectorRunId,
        minimumSamplesPerRouteSize: 0,
        minimumObservationHours: 0
      }
    );

    expect(report.observations).toMatchObject({
      totalJupiterQuotes: 4,
      eligibleComparisons: 4,
      eligibleBaselineComparisons: 1,
      eligibleAnomalyFollowUpComparisons: 3
    });
    expect(
      report.byRouteSize["buy_eurc_jupiter_sell_coinbase|1000"]
        ?.samples
    ).toBe(1);
    expect(report.triggeredRequotes).toMatchObject({
      scheduledProbes: 1,
      completedProbes: 1,
      firstFollowUpsEvaluated: 1,
      confirmedAtFirstFollowUp: 1,
      confirmedThroughAllFollowUps: 0,
      missingTriggerQuote: 0,
      probes: [
        {
          probeId: "request-3",
          expectedFollowUps: 3,
          observedEligibleFollowUps: 3,
          complete: true,
          firstFollowUpConfirmed: true,
          confirmedThroughAllFollowUps: false
        }
      ]
    });
  });
});
