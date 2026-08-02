import {
  bookCheckpointEventSchema,
  bookDeltaEventSchema,
  feedStatusEventSchema,
  marketStatusEventSchema,
  tradeEventSchema,
  type NormalizedEvent
} from "../../collector/schema/events.js";
import {
  collectorRunIdSchema,
  connectionIdSchema,
  nonNegativeSafeIntegerSchema,
  normalizeDecimalString,
  positiveSafeIntegerSchema,
  utcEpochMillisecondsSchema
} from "../../collector/schema/primitives.js";
import {
  BinanceBookIntegrityError,
  BinanceLevel2Book
} from "./book.js";
import {
  assertBinanceProductSet,
  binanceCanonicalProduct,
  type BinancePublicProduct
} from "./constants.js";
import { normalizeBinanceProductMetadata } from "./metadata.js";
import {
  binanceDepthSnapshotSchema,
  binanceDepthUpdateSchema,
  binanceExchangeInfoSchema,
  binanceTradeSchema,
  parseBinanceCombinedStream,
  type BinanceDepthUpdate,
  type BinanceSymbolInfo
} from "./schemas.js";

type FeedState =
  | "connecting"
  | "healthy"
  | "stale"
  | "gapped"
  | "recovering"
  | "stopped";

type FeedStatusEvent = Extract<
  NormalizedEvent,
  { readonly eventType: "feed_status" }
>;

interface ProductRuntime {
  readonly product: BinancePublicProduct;
  book: BinanceLevel2Book;
  bufferedDepth: BinanceDepthUpdate[];
  bookReady: boolean;
  metadataReady: boolean;
  tradeSeen: boolean;
  marketStatus: string | undefined;
  gapped: boolean;
  state: FeedState;
  lastDepthUpdateId: number | undefined;
  lastTradeId: number | undefined;
  lastMarketReceivedTimestampMs: number | undefined;
  lastGoodVenueSequence: string | null;
  gapCount: number;
  crossedBookCount: number;
  snapshotRetryCount: number;
}

export interface BinancePublicAdapterOptions {
  readonly products: readonly BinancePublicProduct[];
  readonly collectorRunId: string;
  readonly depth: number;
  readonly maxTrackedLevelsPerSide: number;
  readonly maxBufferedDepthEvents: number;
  readonly staleAfterMs: number;
  readonly initialIngestSequence?: number;
}

export interface BinanceProductDiagnostics {
  readonly product: BinancePublicProduct;
  readonly state: FeedState;
  readonly bookReady: boolean;
  readonly metadataReady: boolean;
  readonly tradeSeen: boolean;
  readonly marketStatus: string | null;
  readonly bufferedDepthEvents: number;
  readonly lastDepthUpdateId: string | null;
  readonly lastTradeId: string | null;
  readonly lastGoodVenueSequence: string | null;
  readonly gapCount: number;
  readonly crossedBookCount: number;
  readonly snapshotRetryCount: number;
}

export interface BinanceAdapterDiagnostics {
  readonly active: boolean;
  readonly connectionId: string | null;
  readonly lastReceivedTimestampMs: number | null;
  readonly reconnectCount: number;
  readonly products: readonly BinanceProductDiagnostics[];
}

function metadataStatus(product: BinanceSymbolInfo): string {
  if (!product.isSpotTradingAllowed) {
    return "offline";
  }
  if (product.status === "TRADING") {
    return "online";
  }
  if (product.status === "HALT" || product.status === "BREAK") {
    return "offline";
  }
  return "unknown";
}

export class BinancePublicAdapter {
  readonly #products: readonly BinancePublicProduct[];
  readonly #collectorRunId: string;
  readonly #depth: number;
  readonly #maxTrackedLevelsPerSide: number;
  readonly #maxBufferedDepthEvents: number;
  readonly #staleAfterMs: number;
  readonly #runtimes = new Map<BinancePublicProduct, ProductRuntime>();
  #connectionId: string | undefined;
  #active = false;
  #everConnected = false;
  #reconnectCount = 0;
  #nextIngestSequence: number;
  #lastReceivedTimestampMs: number | undefined;

  constructor(options: BinancePublicAdapterOptions) {
    assertBinanceProductSet(options.products);
    this.#products = [...options.products];
    this.#collectorRunId = collectorRunIdSchema.parse(
      options.collectorRunId
    );
    this.#depth = positiveSafeIntegerSchema.max(1_000).parse(options.depth);
    this.#maxTrackedLevelsPerSide = positiveSafeIntegerSchema
      .max(20_000)
      .parse(options.maxTrackedLevelsPerSide);
    this.#maxBufferedDepthEvents = positiveSafeIntegerSchema
      .max(100_000)
      .parse(options.maxBufferedDepthEvents);
    this.#staleAfterMs = positiveSafeIntegerSchema.parse(
      options.staleAfterMs
    );
    this.#nextIngestSequence = nonNegativeSafeIntegerSchema.parse(
      options.initialIngestSequence ?? 0
    );

    for (const product of this.#products) {
      this.#runtimes.set(product, this.#newRuntime(product));
    }
  }

  beginConnection(
    connectionId: string,
    receivedTimestampMs: number
  ): readonly FeedStatusEvent[] {
    if (this.#active) {
      throw new Error("Binance adapter connection is already active");
    }
    this.#connectionId = connectionIdSchema.parse(connectionId);
    const received = utcEpochMillisecondsSchema.parse(receivedTimestampMs);
    if (this.#everConnected) {
      this.#reconnectCount += 1;
    }
    this.#everConnected = true;
    this.#active = true;
    this.#lastReceivedTimestampMs = received;

    return this.#products.map((product) => {
      const replacement = this.#newRuntime(product);
      replacement.state = "connecting";
      const previous = this.#runtimes.get(product);
      if (previous !== undefined) {
        replacement.gapCount = previous.gapCount;
        replacement.crossedBookCount = previous.crossedBookCount;
        replacement.snapshotRetryCount = previous.snapshotRetryCount;
      }
      this.#runtimes.set(product, replacement);
      return this.#feedStatus(
        replacement,
        "connecting",
        false,
        "connection_started",
        null,
        received
      );
    });
  }

  endConnection(
    receivedTimestampMs: number,
    reason = "connection_closed"
  ): readonly FeedStatusEvent[] {
    const received = utcEpochMillisecondsSchema.parse(receivedTimestampMs);
    if (!this.#active) {
      return [];
    }
    this.#active = false;
    return this.#products.map((product) => {
      const runtime = this.#runtime(product);
      runtime.book.reset();
      runtime.bufferedDepth = [];
      runtime.bookReady = false;
      runtime.metadataReady = false;
      runtime.tradeSeen = false;
      runtime.marketStatus = undefined;
      runtime.lastDepthUpdateId = undefined;
      runtime.lastTradeId = undefined;
      runtime.lastMarketReceivedTimestampMs = undefined;
      runtime.state = "recovering";
      return this.#feedStatus(
        runtime,
        "recovering",
        false,
        reason,
        null,
        received
      );
    });
  }

  ingestExchangeInfo(
    input: unknown,
    receivedTimestampMs: number
  ): readonly NormalizedEvent[] {
    this.#assertActive();
    const received = utcEpochMillisecondsSchema.parse(receivedTimestampMs);
    const movedBackwards = this.#recordReceived(received);
    if (movedBackwards) {
      return this.#gapAll(
        "receive_timestamp_moved_backwards",
        null,
        received
      );
    }

    let exchangeInfo;
    try {
      exchangeInfo = binanceExchangeInfoSchema.parse(input);
      const returned = new Set(
        exchangeInfo.symbols.map((symbol) => symbol.symbol)
      );
      if (
        returned.size !== this.#products.length ||
        !this.#products.every((product) => returned.has(product))
      ) {
        throw new Error(
          "exchangeInfo did not contain each configured product exactly once"
        );
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return this.#gapAll(
        `malformed_exchange_info: ${reason}`.slice(0, 512),
        null,
        received
      );
    }

    const output: NormalizedEvent[] = [];
    for (const product of exchangeInfo.symbols) {
      const runtime = this.#runtime(product.symbol);
      if (runtime.gapped) {
        continue;
      }
      const status = metadataStatus(product);
      runtime.metadataReady = true;
      runtime.marketStatus = status;

      output.push(
        normalizeBinanceProductMetadata(product, {
          receivedTimestampMs: received,
          ingestSequence: this.#takeIngestSequence(),
          collectorRunId: this.#collectorRunId,
          connectionId: this.#connectionId!,
          serverTimeMs: exchangeInfo.serverTime
        })
      );
      output.push(
        marketStatusEventSchema.parse({
          ...this.#commonEnvelope(
            runtime.product,
            exchangeInfo.serverTime,
            received,
            null,
            "rest"
          ),
          eventType: "market_status",
          payload: {
            status,
            reason: status === "online" ? null : product.status,
            observedAtMs: received
          }
        })
      );
      output.push(
        ...this.#reevaluateReadiness(
          runtime,
          exchangeInfo.serverTime,
          received,
          runtime.lastGoodVenueSequence,
          "rest"
        )
      );
    }
    return output;
  }

  ingest(
    input: string | unknown,
    receivedTimestampMs: number
  ): readonly NormalizedEvent[] {
    this.#assertActive();
    const received = utcEpochMillisecondsSchema.parse(receivedTimestampMs);
    const movedBackwards = this.#recordReceived(received);
    if (movedBackwards) {
      return this.#gapAll(
        "receive_timestamp_moved_backwards",
        null,
        received
      );
    }

    let message;
    try {
      message = parseBinanceCombinedStream(input);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return this.#gapAll(
        `malformed_message: ${reason}`.slice(0, 512),
        null,
        received
      );
    }

    if (message.data.e === "depthUpdate") {
      const event = binanceDepthUpdateSchema.parse(message.data);
      if (message.stream !== `${event.s.toLowerCase()}@depth@100ms`) {
        return this.#gapAll(
          "stream_event_mismatch",
          String(event.u),
          received
        );
      }
      if (!this.#runtimes.has(event.s)) {
        return this.#gapAll(
          `unconfigured_product:${event.s}`,
          String(event.u),
          received
        );
      }
      return this.#handleDepth(event, received);
    }
    if (message.data.e === "trade") {
      const event = binanceTradeSchema.parse(message.data);
      if (message.stream !== `${event.s.toLowerCase()}@trade`) {
        return this.#gapAll(
          "stream_event_mismatch",
          String(event.t),
          received
        );
      }
      if (!this.#runtimes.has(event.s)) {
        return this.#gapAll(
          `unconfigured_product:${event.s}`,
          String(event.t),
          received
        );
      }
      return this.#handleTrade(event, received);
    }
    return [];
  }

  applyDepthSnapshot(
    product: BinancePublicProduct,
    input: unknown,
    receivedTimestampMs: number
  ): readonly NormalizedEvent[] {
    this.#assertActive();
    const runtime = this.#runtime(product);
    const received = utcEpochMillisecondsSchema.parse(receivedTimestampMs);
    const movedBackwards = this.#recordReceived(received);
    if (movedBackwards) {
      return this.#gapAll(
        "receive_timestamp_moved_backwards",
        null,
        received
      );
    }
    if (runtime.gapped) {
      return [];
    }

    let snapshot;
    try {
      snapshot = binanceDepthSnapshotSchema.parse(input);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return this.#gapProduct(
        runtime,
        `malformed_depth_snapshot: ${reason}`.slice(0, 512),
        null,
        received
      );
    }

    const relevant = runtime.bufferedDepth.filter(
      (event) => event.u > snapshot.lastUpdateId
    );
    const first = relevant[0];
    if (
      first !== undefined &&
      first.U > snapshot.lastUpdateId + 1
    ) {
      runtime.snapshotRetryCount += 1;
      runtime.state = "recovering";
      return [
        this.#feedStatus(
          runtime,
          "recovering",
          false,
          `snapshot_too_old:${snapshot.lastUpdateId}->${first.U}`,
          String(snapshot.lastUpdateId),
          received
        )
      ];
    }

    const candidate = new BinanceLevel2Book(
      this.#maxTrackedLevelsPerSide
    );
    let currentUpdateId = snapshot.lastUpdateId;
    let latestSourceTimestampMs: number | null = null;
    try {
      candidate.applySnapshot(snapshot);
      for (const event of relevant) {
        if (event.u <= currentUpdateId) {
          continue;
        }
        if (event.U > currentUpdateId + 1) {
          return this.#gapProduct(
            runtime,
            `depth_sequence_gap:${currentUpdateId}->${event.U}`,
            String(event.u),
            received
          );
        }
        candidate.applyUpdate(event);
        currentUpdateId = event.u;
        latestSourceTimestampMs = event.E;
      }
    } catch (error) {
      if (
        error instanceof BinanceBookIntegrityError &&
        error.code === "crossed_book"
      ) {
        runtime.crossedBookCount += 1;
      }
      const reason =
        error instanceof BinanceBookIntegrityError
          ? `book_${error.code}`
          : "invalid_depth_snapshot";
      return this.#gapProduct(
        runtime,
        reason,
        String(currentUpdateId),
        received
      );
    }

    runtime.book = candidate;
    runtime.bufferedDepth = [];
    runtime.bookReady = true;
    runtime.lastDepthUpdateId = currentUpdateId;
    runtime.lastMarketReceivedTimestampMs = received;
    runtime.lastGoodVenueSequence = String(currentUpdateId);
    const top = runtime.book.top(this.#depth);
    const output: NormalizedEvent[] = [
      bookCheckpointEventSchema.parse({
        ...this.#commonEnvelope(
          product,
          latestSourceTimestampMs,
          received,
          String(currentUpdateId),
          "rest"
        ),
        eventType: "book_checkpoint",
        payload: {
          bids: top.bids,
          asks: top.asks,
          depth: this.#depth,
          checksum: null,
          isRecovery: this.#reconnectCount > 0
        }
      })
    ];
    output.push(
      ...this.#reevaluateReadiness(
        runtime,
        latestSourceTimestampMs,
        received,
        String(currentUpdateId),
        "rest"
      )
    );
    return output;
  }

  checkStaleness(nowTimestampMs: number): readonly FeedStatusEvent[] {
    const now = utcEpochMillisecondsSchema.parse(nowTimestampMs);
    if (!this.#active) {
      return [];
    }

    const output: FeedStatusEvent[] = [];
    for (const product of this.#products) {
      const runtime = this.#runtime(product);
      const lastReceived = runtime.lastMarketReceivedTimestampMs;
      if (
        runtime.gapped ||
        !runtime.bookReady ||
        lastReceived === undefined ||
        now - lastReceived <= this.#staleAfterMs ||
        runtime.state === "stale"
      ) {
        continue;
      }
      runtime.state = "stale";
      output.push(
        this.#feedStatus(
          runtime,
          "stale",
          false,
          `no_market_message_for_${now - lastReceived}ms`,
          runtime.lastGoodVenueSequence,
          now
        )
      );
    }
    return output;
  }

  diagnostics(): BinanceAdapterDiagnostics {
    return {
      active: this.#active,
      connectionId: this.#connectionId ?? null,
      lastReceivedTimestampMs: this.#lastReceivedTimestampMs ?? null,
      reconnectCount: this.#reconnectCount,
      products: this.#products.map((product) => {
        const runtime = this.#runtime(product);
        return {
          product,
          state: runtime.state,
          bookReady: runtime.bookReady,
          metadataReady: runtime.metadataReady,
          tradeSeen: runtime.tradeSeen,
          marketStatus: runtime.marketStatus ?? null,
          bufferedDepthEvents: runtime.bufferedDepth.length,
          lastDepthUpdateId:
            runtime.lastDepthUpdateId === undefined
              ? null
              : String(runtime.lastDepthUpdateId),
          lastTradeId:
            runtime.lastTradeId === undefined
              ? null
              : String(runtime.lastTradeId),
          lastGoodVenueSequence: runtime.lastGoodVenueSequence,
          gapCount: runtime.gapCount,
          crossedBookCount: runtime.crossedBookCount,
          snapshotRetryCount: runtime.snapshotRetryCount
        };
      })
    };
  }

  #handleDepth(
    event: BinanceDepthUpdate,
    received: number
  ): readonly NormalizedEvent[] {
    const runtime = this.#runtime(event.s);
    if (runtime.gapped) {
      return [];
    }

    if (!runtime.bookReady) {
      const previous = runtime.bufferedDepth.at(-1);
      if (
        previous !== undefined &&
        (event.u <= previous.u || event.U > previous.u + 1)
      ) {
        return this.#gapProduct(
          runtime,
          event.u <= previous.u
            ? "buffered_depth_out_of_order"
            : `buffered_depth_gap:${previous.u}->${event.U}`,
          String(event.u),
          received
        );
      }
      if (
        runtime.bufferedDepth.length >= this.#maxBufferedDepthEvents
      ) {
        return this.#gapProduct(
          runtime,
          "depth_buffer_limit",
          String(event.u),
          received
        );
      }
      runtime.bufferedDepth.push(event);
      return [];
    }

    const previousUpdateId = runtime.lastDepthUpdateId;
    if (previousUpdateId === undefined) {
      return this.#gapProduct(
        runtime,
        "missing_depth_sequence",
        String(event.u),
        received
      );
    }
    if (event.u <= previousUpdateId) {
      return [];
    }
    if (event.U > previousUpdateId + 1) {
      return this.#gapProduct(
        runtime,
        `depth_sequence_gap:${previousUpdateId}->${event.U}`,
        String(event.u),
        received
      );
    }

    try {
      runtime.book.applyUpdate(event);
    } catch (error) {
      if (
        error instanceof BinanceBookIntegrityError &&
        error.code === "crossed_book"
      ) {
        runtime.crossedBookCount += 1;
      }
      const reason =
        error instanceof BinanceBookIntegrityError
          ? `book_${error.code}`
          : "invalid_depth_update";
      return this.#gapProduct(
        runtime,
        reason,
        String(event.u),
        received
      );
    }

    runtime.lastDepthUpdateId = event.u;
    runtime.lastMarketReceivedTimestampMs = received;
    runtime.lastGoodVenueSequence = String(event.u);
    const output: NormalizedEvent[] = [
      bookDeltaEventSchema.parse({
        ...this.#commonEnvelope(
          runtime.product,
          event.E,
          received,
          String(event.u),
          "websocket"
        ),
        eventType: "book_delta",
        payload: {
          updateSemantics: "absolute",
          firstVenueSequence: String(event.U),
          lastVenueSequence: String(event.u),
          changes: [
            ...event.b.map(([price, quantity]) => ({
              side: "bid" as const,
              price: normalizeDecimalString(price),
              quantity: normalizeDecimalString(quantity)
            })),
            ...event.a.map(([price, quantity]) => ({
              side: "ask" as const,
              price: normalizeDecimalString(price),
              quantity: normalizeDecimalString(quantity)
            }))
          ]
        }
      })
    ];
    output.push(
      ...this.#reevaluateReadiness(
        runtime,
        event.E,
        received,
        String(event.u),
        "websocket"
      )
    );
    return output;
  }

  #handleTrade(
    event: ReturnType<typeof binanceTradeSchema.parse>,
    received: number
  ): readonly NormalizedEvent[] {
    const runtime = this.#runtime(event.s);
    if (runtime.gapped) {
      return [];
    }
    if (
      runtime.lastTradeId !== undefined &&
      event.t !== runtime.lastTradeId + 1
    ) {
      return this.#gapProduct(
        runtime,
        event.t <= runtime.lastTradeId
          ? "trade_id_out_of_order"
          : `trade_id_gap:${runtime.lastTradeId}->${event.t}`,
        String(event.t),
        received
      );
    }

    runtime.lastTradeId = event.t;
    runtime.tradeSeen = true;
    runtime.lastMarketReceivedTimestampMs = received;
    runtime.lastGoodVenueSequence =
      runtime.lastDepthUpdateId === undefined
        ? String(event.t)
        : String(runtime.lastDepthUpdateId);
    const output: NormalizedEvent[] = [
      tradeEventSchema.parse({
        ...this.#commonEnvelope(
          runtime.product,
          event.T,
          received,
          String(event.t),
          "websocket"
        ),
        eventType: "trade",
        payload: {
          tradeId: String(event.t),
          price: normalizeDecimalString(event.p),
          quantity: normalizeDecimalString(event.q),
          aggressorSide: event.m ? "sell" : "buy"
        }
      })
    ];
    output.push(
      ...this.#reevaluateReadiness(
        runtime,
        event.T,
        received,
        runtime.lastGoodVenueSequence,
        "websocket"
      )
    );
    return output;
  }

  #reevaluateReadiness(
    runtime: ProductRuntime,
    sourceTimestampMs: number | null,
    received: number,
    venueSequence: string | null,
    source: "websocket" | "rest"
  ): readonly FeedStatusEvent[] {
    if (runtime.gapped) {
      return [];
    }

    if (
      runtime.metadataReady &&
      runtime.marketStatus !== "online"
    ) {
      if (runtime.state === "stopped") {
        return [];
      }
      runtime.state = "stopped";
      return [
        this.#feedStatus(
          runtime,
          "stopped",
          false,
          `market_status_${runtime.marketStatus ?? "unknown"}`,
          venueSequence,
          received,
          sourceTimestampMs,
          source
        )
      ];
    }

    if (runtime.bookReady && runtime.metadataReady) {
      if (runtime.state === "healthy") {
        return [];
      }
      runtime.state = "healthy";
      return [
        this.#feedStatus(
          runtime,
          "healthy",
          true,
          null,
          venueSequence,
          received,
          sourceTimestampMs,
          source
        )
      ];
    }
    return [];
  }

  #gapAll(
    reason: string,
    venueSequence: string | null,
    received: number
  ): readonly FeedStatusEvent[] {
    return this.#products.flatMap((product) =>
      this.#gapProduct(
        this.#runtime(product),
        reason,
        venueSequence,
        received
      )
    );
  }

  #gapProduct(
    runtime: ProductRuntime,
    reason: string,
    venueSequence: string | null,
    received: number
  ): readonly FeedStatusEvent[] {
    if (runtime.gapped) {
      return [];
    }
    runtime.gapped = true;
    runtime.state = "gapped";
    runtime.gapCount += 1;
    runtime.book.reset();
    runtime.bufferedDepth = [];
    runtime.bookReady = false;
    runtime.lastDepthUpdateId = undefined;
    runtime.lastGoodVenueSequence = venueSequence;
    return [
      this.#feedStatus(
        runtime,
        "gapped",
        false,
        reason,
        venueSequence,
        received
      )
    ];
  }

  #feedStatus(
    runtime: ProductRuntime,
    state: FeedState,
    eligibleForResearch: boolean,
    reason: string | null,
    venueSequence: string | null,
    received: number,
    sourceTimestampMs: number | null = null,
    source: "websocket" | "rest" = "websocket"
  ): FeedStatusEvent {
    return feedStatusEventSchema.parse({
      ...this.#commonEnvelope(
        runtime.product,
        sourceTimestampMs,
        received,
        venueSequence,
        source
      ),
      eventType: "feed_status",
      payload: {
        state,
        eligibleForResearch,
        reason,
        lastGoodVenueSequence: runtime.lastGoodVenueSequence,
        observedAtMs: received
      }
    });
  }

  #commonEnvelope(
    product: BinancePublicProduct,
    sourceTimestampMs: number | null,
    receivedTimestampMs: number,
    venueSequence: string | null,
    source: "websocket" | "rest"
  ): Omit<NormalizedEvent, "eventType" | "payload"> {
    return {
      schemaVersion: 1,
      venue: "binance",
      product: binanceCanonicalProduct(product),
      nativeProduct: product,
      sourceTimestampMs,
      receivedTimestampMs,
      ingestSequence: this.#takeIngestSequence(),
      collectorRunId: this.#collectorRunId,
      connectionId: this.#connectionId!,
      venueSequence,
      source
    };
  }

  #takeIngestSequence(): number {
    const value = nonNegativeSafeIntegerSchema.parse(
      this.#nextIngestSequence
    );
    if (value === Number.MAX_SAFE_INTEGER) {
      throw new Error("Binance ingest sequence exhausted");
    }
    this.#nextIngestSequence += 1;
    return value;
  }

  #recordReceived(received: number): boolean {
    const movedBackwards =
      this.#lastReceivedTimestampMs !== undefined &&
      received < this.#lastReceivedTimestampMs;
    if (!movedBackwards) {
      this.#lastReceivedTimestampMs = received;
    }
    return movedBackwards;
  }

  #assertActive(): void {
    if (!this.#active || this.#connectionId === undefined) {
      throw new Error("Binance adapter connection is not active");
    }
  }

  #runtime(product: BinancePublicProduct): ProductRuntime {
    const runtime = this.#runtimes.get(product);
    if (runtime === undefined) {
      throw new Error(`Unconfigured Binance product: ${product}`);
    }
    return runtime;
  }

  #newRuntime(product: BinancePublicProduct): ProductRuntime {
    return {
      product,
      book: new BinanceLevel2Book(this.#maxTrackedLevelsPerSide),
      bufferedDepth: [],
      bookReady: false,
      metadataReady: false,
      tradeSeen: false,
      marketStatus: undefined,
      gapped: false,
      state: "stopped",
      lastDepthUpdateId: undefined,
      lastTradeId: undefined,
      lastMarketReceivedTimestampMs: undefined,
      lastGoodVenueSequence: null,
      gapCount: 0,
      crossedBookCount: 0,
      snapshotRetryCount: 0
    };
  }
}
