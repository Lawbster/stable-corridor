import {
  cexDexProbeEventSchema,
  type NormalizedEvent
} from "../collector/schema/events.js";
import { numberToCanonicalDecimal } from "../venues/jupiter/amounts.js";
import {
  CoinbaseExecutableBook,
  compareCoinbaseJupiterQuote,
  type CexDexCostModel
} from "./cex-dex-model.js";

type CexDexProbeEvent = Extract<
  NormalizedEvent,
  { readonly eventType: "cex_dex_probe" }
>;

export interface CexDexAnomalyProbeOptions extends CexDexCostModel {
  readonly decisionThresholdBps: number;
  readonly followUpCount: number;
  readonly minimumRequestIntervalMs: number;
}

export interface CexDexProbeTrigger {
  readonly event: CexDexProbeEvent;
  readonly triggerRequestId: string;
  readonly followUpCount: number;
}

function assertFiniteWithin(
  value: number,
  label: string,
  minimum: number,
  maximum: number
): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

export class CexDexAnomalyProbe {
  readonly #options: CexDexAnomalyProbeOptions;
  readonly #book = new CoinbaseExecutableBook();
  #coinbaseEligible = false;

  constructor(options: CexDexAnomalyProbeOptions) {
    assertFiniteWithin(options.coinbaseFeeBps, "Coinbase fee bps", 0, 100);
    assertFiniteWithin(
      options.modeledNetworkFeeUsdc,
      "modeled network fee USDC",
      0,
      10
    );
    assertFiniteWithin(
      options.executionBufferBps,
      "execution buffer bps",
      0,
      100
    );
    assertFiniteWithin(
      options.decisionThresholdBps,
      "decision threshold bps",
      Number.EPSILON,
      100
    );
    if (
      !Number.isSafeInteger(options.followUpCount) ||
      options.followUpCount < 1 ||
      options.followUpCount > 10
    ) {
      throw new Error(`Invalid follow-up count: ${options.followUpCount}`);
    }
    if (
      !Number.isSafeInteger(options.minimumRequestIntervalMs) ||
      options.minimumRequestIntervalMs < 2_000
    ) {
      throw new Error(
        `Invalid minimum request interval: ${options.minimumRequestIntervalMs}`
      );
    }
    this.#options = options;
  }

  observe(
    events: readonly NormalizedEvent[]
  ): CexDexProbeTrigger | null {
    let trigger: CexDexProbeTrigger | null = null;
    for (const event of events) {
      if (
        event.venue === "coinbase" &&
        event.product === "EURC-USDC"
      ) {
        if (event.eventType === "feed_status") {
          this.#coinbaseEligible =
            event.payload.state === "healthy" &&
            event.payload.eligibleForResearch;
        } else if (event.eventType === "book_checkpoint") {
          this.#book.reset(event);
        } else if (event.eventType === "book_delta") {
          this.#book.apply(event);
        }
        continue;
      }
      if (
        event.venue !== "jupiter" ||
        event.product !== "EURC-USDC" ||
        event.eventType !== "dex_quote" ||
        event.payload.probe?.kind === "anomaly_follow_up"
      ) {
        continue;
      }
      if (
        !this.#coinbaseEligible ||
        !this.#book.ready ||
        this.#book.crossed()
      ) {
        continue;
      }
      const sample = compareCoinbaseJupiterQuote(
        event,
        this.#book,
        this.#options
      );
      if (
        sample === null ||
        sample.modeledNetEdgeBps < this.#options.decisionThresholdBps
      ) {
        continue;
      }
      const probeEvent = cexDexProbeEventSchema.parse({
        ...event,
        source: "derived",
        eventType: "cex_dex_probe",
        payload: {
          probeId: event.payload.requestId,
          triggerRequestId: event.payload.requestId,
          direction: sample.direction,
          inputAmount: sample.inputAmount,
          router: sample.router,
          triggerReceivedTimestampMs: event.receivedTimestampMs,
          grossEdgeBps: numberToCanonicalDecimal(sample.grossEdgeBps),
          modeledNetEdgeBps: numberToCanonicalDecimal(
            sample.modeledNetEdgeBps
          ),
          capitalUsdc: numberToCanonicalDecimal(sample.capitalUsdc),
          followUpCount: this.#options.followUpCount,
          minimumRequestIntervalMs:
            this.#options.minimumRequestIntervalMs,
          model: {
            coinbaseFeeBps: numberToCanonicalDecimal(
              this.#options.coinbaseFeeBps
            ),
            modeledNetworkFeeUsdc: numberToCanonicalDecimal(
              this.#options.modeledNetworkFeeUsdc
            ),
            executionBufferBps: numberToCanonicalDecimal(
              this.#options.executionBufferBps
            ),
            decisionThresholdBps: numberToCanonicalDecimal(
              this.#options.decisionThresholdBps
            )
          }
        }
      });
      trigger = {
        event: probeEvent,
        triggerRequestId: event.payload.requestId,
        followUpCount: this.#options.followUpCount
      };
    }
    return trigger;
  }
}
