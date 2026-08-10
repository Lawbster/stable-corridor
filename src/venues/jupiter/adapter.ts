import {
  dexQuoteEventSchema,
  feedStatusEventSchema,
  type NormalizedEvent
} from "../../collector/schema/events.js";
import {
  collectorRunIdSchema,
  connectionIdSchema,
  nonNegativeSafeIntegerSchema,
  positiveSafeIntegerSchema,
  utcEpochMillisecondsSchema
} from "../../collector/schema/primitives.js";
import {
  atomicToDecimal,
  normalizeJupiterDecimal
} from "./amounts.js";
import {
  createJupiterQuoteRequests,
  JUPITER_ASSETS,
  JUPITER_PUBLIC_PRODUCT,
  jupiterQuoteRequestKey,
  type JupiterApprovedInputAmount,
  type JupiterQuoteRequest,
  type JupiterQuoteRequestContext
} from "./constants.js";
import {
  parseJupiterOrderQuote,
  type JupiterOrderQuote
} from "./schemas.js";

type FeedState =
  | "connecting"
  | "healthy"
  | "stale"
  | "recovering"
  | "stopped";

type FeedStatusEvent = Extract<
  NormalizedEvent,
  { readonly eventType: "feed_status" }
>;
type DexQuoteEvent = Extract<
  NormalizedEvent,
  { readonly eventType: "dex_quote" }
>;

export interface JupiterPublicAdapterOptions {
  readonly collectorRunId: string;
  readonly inputAmounts: readonly JupiterApprovedInputAmount[];
  readonly staleAfterMs: number;
  readonly initialIngestSequence?: number;
}

export interface JupiterAdapterDiagnostics {
  readonly active: boolean;
  readonly connectionId: string | null;
  readonly state: FeedState;
  readonly expectedQuoteCount: number;
  readonly observedQuoteCount: number;
  readonly lastGoodVenueSequence: string | null;
  readonly lastReceivedTimestampMs: number | null;
  readonly quoteCount: number;
  readonly failureCount: number;
  readonly reconnectCount: number;
}

export interface JupiterQuoteObservation {
  readonly request: JupiterQuoteRequest;
  readonly response: unknown;
  readonly requestStartedAtMs: number;
  readonly receivedTimestampMs: number;
  readonly context?: JupiterQuoteRequestContext;
}

export class JupiterPublicAdapter {
  readonly #collectorRunId: string;
  readonly #staleAfterMs: number;
  readonly #requests: readonly JupiterQuoteRequest[];
  readonly #expectedKeys: ReadonlySet<string>;
  readonly #observedKeys = new Set<string>();
  #connectionId: string | undefined;
  #state: FeedState = "stopped";
  #active = false;
  #everConnected = false;
  #reconnectCount = 0;
  #nextIngestSequence: number;
  #lastReceivedTimestampMs: number | undefined;
  #connectionStartedAtMs: number | undefined;
  #lastGoodVenueSequence: string | null = null;
  #quoteCount = 0;
  #failureCount = 0;

  constructor(options: JupiterPublicAdapterOptions) {
    this.#collectorRunId = collectorRunIdSchema.parse(
      options.collectorRunId
    );
    this.#staleAfterMs = positiveSafeIntegerSchema.parse(
      options.staleAfterMs
    );
    this.#requests = createJupiterQuoteRequests(options.inputAmounts);
    this.#expectedKeys = new Set(
      this.#requests.map(jupiterQuoteRequestKey)
    );
    this.#nextIngestSequence = nonNegativeSafeIntegerSchema.parse(
      options.initialIngestSequence ?? 0
    );
  }

  beginConnection(
    connectionId: string,
    receivedTimestampMs: number
  ): readonly FeedStatusEvent[] {
    if (this.#active) {
      throw new Error("Jupiter adapter connection is already active");
    }
    this.#connectionId = connectionIdSchema.parse(connectionId);
    const received = utcEpochMillisecondsSchema.parse(receivedTimestampMs);
    if (this.#everConnected) {
      this.#reconnectCount += 1;
    }
    this.#everConnected = true;
    this.#active = true;
    this.#state = "connecting";
    this.#connectionStartedAtMs = received;
    this.#lastReceivedTimestampMs = undefined;
    this.#lastGoodVenueSequence = null;
    this.#observedKeys.clear();
    return [this.#status("connecting", false, "connection_started", received)];
  }

  ingestQuote(
    observation: JupiterQuoteObservation
  ): readonly NormalizedEvent[] {
    this.#assertActive();
    const requestStartedAtMs = utcEpochMillisecondsSchema.parse(
      observation.requestStartedAtMs
    );
    const receivedTimestampMs = utcEpochMillisecondsSchema.parse(
      observation.receivedTimestampMs
    );
    if (receivedTimestampMs < requestStartedAtMs) {
      throw new Error("Jupiter receive time predates request start");
    }
    const quote = parseJupiterOrderQuote(observation.response);
    this.#assertQuoteMatchesRequest(quote, observation.request);

    const input = JUPITER_ASSETS[observation.request.inputAsset];
    const output = JUPITER_ASSETS[observation.request.outputAsset];
    const event = dexQuoteEventSchema.parse({
      ...this.#envelope(receivedTimestampMs, quote.requestId),
      eventType: "dex_quote",
      payload: {
        quoteKind: "exact_in",
        inputAsset: observation.request.inputAsset,
        outputAsset: observation.request.outputAsset,
        inputMint: quote.inputMint,
        outputMint: quote.outputMint,
        inputDecimals: input.decimals,
        outputDecimals: output.decimals,
        inputAmountAtomic: quote.inAmount,
        outputAmountAtomic: quote.outAmount,
        minimumOutputAmountAtomic: quote.otherAmountThreshold,
        inputAmount: atomicToDecimal(quote.inAmount, input.decimals),
        outputAmount: atomicToDecimal(quote.outAmount, output.decimals),
        minimumOutputAmount: atomicToDecimal(
          quote.otherAmountThreshold,
          output.decimals
        ),
        requestStartedAtMs,
        quoteLatencyMs: receivedTimestampMs - requestStartedAtMs,
        providerProcessingMs: Math.round(quote.totalTime),
        slippageBps: quote.slippageBps,
        feeBps: quote.feeBps,
        platformFeeBps: quote.platformFee.feeBps,
        priceImpactPct: normalizeJupiterDecimal(quote.priceImpactPct),
        signatureFeeLamports: quote.signatureFeeLamports,
        prioritizationFeeLamports: quote.prioritizationFeeLamports,
        rentFeeLamports: quote.rentFeeLamports,
        router: quote.router,
        swapType: quote.swapType,
        gasless: quote.gasless,
        guaranteedPrice: quote.guaranteedPrice,
        requestId: quote.requestId,
        quoteId: quote.quoteId ?? null,
        probe: observation.context ?? { kind: "baseline" },
        routePlan: quote.routePlan.map((leg) => ({
          ammKey: leg.swapInfo.ammKey,
          label: leg.swapInfo.label,
          inputMint: leg.swapInfo.inputMint,
          outputMint: leg.swapInfo.outputMint,
          inputAmountAtomic: leg.swapInfo.inAmount,
          outputAmountAtomic: leg.swapInfo.outAmount,
          percentBps: leg.bps
        }))
      }
    }) as DexQuoteEvent;

    this.#quoteCount += 1;
    this.#lastReceivedTimestampMs = receivedTimestampMs;
    this.#lastGoodVenueSequence = quote.requestId;
    this.#observedKeys.add(jupiterQuoteRequestKey(observation.request));
    const events: NormalizedEvent[] = [event];
    if (
      this.#observedKeys.size === this.#expectedKeys.size &&
      this.#state !== "healthy"
    ) {
      this.#state = "healthy";
      events.push(this.#status("healthy", true, null, receivedTimestampMs));
    }
    return events;
  }

  recordFailure(
    error: unknown,
    receivedTimestampMs: number
  ): readonly FeedStatusEvent[] {
    this.#assertActive();
    const received = utcEpochMillisecondsSchema.parse(receivedTimestampMs);
    this.#failureCount += 1;
    if (this.#state === "recovering") {
      return [];
    }
    this.#state = "recovering";
    const description =
      error instanceof Error ? error.message : String(error);
    return [
      this.#status(
        "recovering",
        false,
        `quote_failure:${description}`.slice(0, 512),
        received
      )
    ];
  }

  checkStaleness(nowTimestampMs: number): readonly FeedStatusEvent[] {
    if (!this.#active || this.#state === "stale") {
      return [];
    }
    const now = utcEpochMillisecondsSchema.parse(nowTimestampMs);
    const reference =
      this.#lastReceivedTimestampMs ?? this.#connectionStartedAtMs;
    if (
      reference === undefined ||
      now - reference <= this.#staleAfterMs
    ) {
      return [];
    }
    this.#state = "stale";
    return [
      this.#status(
        "stale",
        false,
        `no_successful_quote_for_${now - reference}ms`,
        now
      )
    ];
  }

  endConnection(
    receivedTimestampMs: number,
    reason = "connection_stopped"
  ): readonly FeedStatusEvent[] {
    if (!this.#active) {
      return [];
    }
    const received = utcEpochMillisecondsSchema.parse(receivedTimestampMs);
    const status = this.#status(
      "stopped",
      false,
      reason.slice(0, 512),
      received
    );
    this.#active = false;
    this.#state = "stopped";
    return [status];
  }

  diagnostics(): JupiterAdapterDiagnostics {
    return {
      active: this.#active,
      connectionId: this.#connectionId ?? null,
      state: this.#state,
      expectedQuoteCount: this.#expectedKeys.size,
      observedQuoteCount: this.#observedKeys.size,
      lastGoodVenueSequence: this.#lastGoodVenueSequence,
      lastReceivedTimestampMs: this.#lastReceivedTimestampMs ?? null,
      quoteCount: this.#quoteCount,
      failureCount: this.#failureCount,
      reconnectCount: this.#reconnectCount
    };
  }

  #assertQuoteMatchesRequest(
    quote: JupiterOrderQuote,
    request: JupiterQuoteRequest
  ): void {
    const input = JUPITER_ASSETS[request.inputAsset];
    const output = JUPITER_ASSETS[request.outputAsset];
    if (
      quote.inputMint !== input.mint ||
      quote.outputMint !== output.mint ||
      quote.inAmount !== request.inputAmountAtomic
    ) {
      throw new Error("Jupiter quote did not match the approved request");
    }
  }

  #assertActive(): void {
    if (!this.#active || this.#connectionId === undefined) {
      throw new Error("Jupiter adapter connection is not active");
    }
  }

  #envelope(receivedTimestampMs: number, venueSequence: string | null) {
    this.#assertActive();
    const ingestSequence = this.#nextIngestSequence;
    this.#nextIngestSequence += 1;
    return {
      schemaVersion: 1 as const,
      venue: "jupiter",
      product: JUPITER_PUBLIC_PRODUCT,
      nativeProduct: JUPITER_PUBLIC_PRODUCT,
      sourceTimestampMs: null,
      receivedTimestampMs,
      ingestSequence,
      collectorRunId: this.#collectorRunId,
      connectionId: this.#connectionId!,
      venueSequence,
      source: "rest" as const
    };
  }

  #status(
    state: FeedState,
    eligibleForResearch: boolean,
    reason: string | null,
    receivedTimestampMs: number
  ): FeedStatusEvent {
    return feedStatusEventSchema.parse({
      ...this.#envelope(
        receivedTimestampMs,
        this.#lastGoodVenueSequence
      ),
      eventType: "feed_status",
      payload: {
        state,
        eligibleForResearch,
        reason,
        lastGoodVenueSequence: this.#lastGoodVenueSequence,
        observedAtMs: receivedTimestampMs
      }
    });
  }
}
