import { describe, expect, it } from "vitest";

import {
  bookDeltaEventSchema,
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
  ingestSequence: number
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
});
