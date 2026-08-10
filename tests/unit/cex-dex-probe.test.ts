import { describe, expect, it } from "vitest";

import {
  dexQuoteEventSchema,
  feedStatusEventSchema,
  type NormalizedEvent
} from "../../src/collector/schema/events.js";
import { CexDexAnomalyProbe } from "../../src/opportunity/cex-dex-probe.js";
import { JUPITER_ASSETS } from "../../src/venues/jupiter/constants.js";
import { makeBookCheckpointEvent } from "../fixtures/events.js";

const collectorRunId = "11111111-1111-4111-8111-111111111111";
const connectionId = "22222222-2222-4222-8222-222222222222";
const receivedTimestampMs = 1_700_000_000_000;

function envelope(venue: string, ingestSequence: number) {
  return {
    schemaVersion: 1 as const,
    venue,
    product: "EURC-USDC",
    nativeProduct: "EURC-USDC",
    sourceTimestampMs: null,
    receivedTimestampMs: receivedTimestampMs + ingestSequence,
    ingestSequence,
    collectorRunId,
    connectionId,
    venueSequence: String(ingestSequence),
    source: venue === "jupiter" ? ("rest" as const) : ("websocket" as const)
  };
}

function healthyCoinbase(): NormalizedEvent {
  return feedStatusEventSchema.parse({
    ...envelope("coinbase", 2),
    eventType: "feed_status",
    payload: {
      state: "healthy",
      eligibleForResearch: true,
      reason: null,
      lastGoodVenueSequence: "1",
      observedAtMs: receivedTimestampMs + 2
    }
  });
}

function jupiterQuote(
  probe: { readonly kind: "baseline" } | {
    readonly kind: "anomaly_follow_up";
    readonly triggerRequestId: string;
    readonly followUpIndex: number;
  }
): NormalizedEvent {
  return dexQuoteEventSchema.parse({
    ...envelope("jupiter", 3),
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
      outputAmountAtomic: "900000000",
      minimumOutputAmountAtomic: "900000000",
      inputAmount: "1000",
      outputAmount: "900",
      minimumOutputAmount: "900",
      requestStartedAtMs: receivedTimestampMs,
      quoteLatencyMs: 3,
      providerProcessingMs: 2,
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
      guaranteedPrice: false,
      requestId: "trigger-request",
      quoteId: null,
      probe,
      routePlan: [
        {
          ammKey: "test-amm",
          label: "JupiterZ",
          inputMint: JUPITER_ASSETS.USDC.mint,
          outputMint: JUPITER_ASSETS.EURC.mint,
          inputAmountAtomic: "1000000000",
          outputAmountAtomic: "900000000",
          percentBps: 10_000
        }
      ]
    }
  });
}

describe("Coinbase/Jupiter anomaly probe", () => {
  it("journals an eligible baseline trigger and ignores its follow-ups", () => {
    const probe = new CexDexAnomalyProbe({
      coinbaseFeeBps: 0.1,
      modeledNetworkFeeUsdc: 0.01,
      executionBufferBps: 2,
      decisionThresholdBps: 3,
      followUpCount: 3,
      minimumRequestIntervalMs: 2_100
    });
    const checkpoint = makeBookCheckpointEvent({
      collectorRunId,
      connectionId,
      receivedTimestampMs: receivedTimestampMs + 1,
      bidPrice: "1.12",
      askPrice: "1.121",
      bidQuantity: "2000",
      askQuantity: "2000"
    });

    expect(probe.observe([checkpoint, healthyCoinbase()])).toBeNull();
    const trigger = probe.observe([jupiterQuote({ kind: "baseline" })]);

    expect(trigger).toMatchObject({
      triggerRequestId: "trigger-request",
      followUpCount: 3,
      event: {
        eventType: "cex_dex_probe",
        source: "derived",
        payload: {
          probeId: "trigger-request",
          triggerRequestId: "trigger-request",
          direction: "buy_eurc_jupiter_sell_coinbase",
          inputAmount: "1000",
          followUpCount: 3,
          minimumRequestIntervalMs: 2_100,
          model: {
            decisionThresholdBps: "3"
          }
        }
      }
    });
    expect(
      Number(trigger?.event.payload.modeledNetEdgeBps)
    ).toBeGreaterThan(3);
    expect(
      probe.observe([
        jupiterQuote({
          kind: "anomaly_follow_up",
          triggerRequestId: "trigger-request",
          followUpIndex: 1
        })
      ])
    ).toBeNull();
  });
});
