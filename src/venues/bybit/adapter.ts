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
  BybitBookIntegrityError,
  BybitLevel2Book
} from "./book.js";
import {
  assertBybitProductSet,
  assertBybitPublicProduct,
  bybitCanonicalProduct,
  BYBIT_ORDERBOOK_DEPTH,
  type BybitPublicProduct
} from "./constants.js";
import { normalizeBybitProductMetadata } from "./metadata.js";
import {
  bybitInstrumentResponseSchema,
  bybitOrderbookMessageSchema,
  bybitPongResponseSchema,
  bybitPublicTradeMessageSchema,
  bybitSubscriptionResponseSchema,
  parseBybitPublicMessage,
  type BybitOrderbookMessage,
  type BybitPublicTradeMessage,
  type BybitSpotInstrument
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
  readonly product: BybitPublicProduct;
  readonly book: BybitLevel2Book;
  readonly recentTradeIds: Set<string>;
  readonly recentTradeIdQueue: string[];
  bookReady: boolean;
  metadataReady: boolean;
  tradeSeen: boolean;
  marketStatus: string | undefined;
  gapped: boolean;
  state: FeedState;
  lastBookUpdateId: number | undefined;
  lastBookCrossSequence: number | undefined;
  lastTradeSequence: number | undefined;
  lastMarketReceivedTimestampMs: number | undefined;
  lastGoodVenueSequence: string | null;
  gapCount: number;
  crossedBookCount: number;
  snapshotCount: number;
}

export interface BybitPublicAdapterOptions {
  readonly products: readonly BybitPublicProduct[];
  readonly collectorRunId: string;
  readonly depth: number;
  readonly maxTrackedLevelsPerSide: number;
  readonly maxRecentTradeIds: number;
  readonly staleAfterMs: number;
  readonly initialIngestSequence?: number;
}

export interface BybitProductDiagnostics {
  readonly product: BybitPublicProduct;
  readonly state: FeedState;
  readonly bookReady: boolean;
  readonly metadataReady: boolean;
  readonly tradeSeen: boolean;
  readonly marketStatus: string | null;
  readonly lastBookUpdateId: string | null;
  readonly lastBookCrossSequence: string | null;
  readonly lastTradeSequence: string | null;
  readonly lastGoodVenueSequence: string | null;
  readonly gapCount: number;
  readonly crossedBookCount: number;
  readonly snapshotCount: number;
}

export interface BybitAdapterDiagnostics {
  readonly active: boolean;
  readonly connectionId: string | null;
  readonly subscriptionReady: boolean;
  readonly pongCount: number;
  readonly lastReceivedTimestampMs: number | null;
  readonly reconnectCount: number;
  readonly products: readonly BybitProductDiagnostics[];
}

function metadataStatus(product: BybitSpotInstrument): string {
  if (product.status === "Trading") {
    return "online";
  }
  if (
    product.status === "Closed" ||
    product.status === "Settled" ||
    product.status === "Delisted"
  ) {
    return "offline";
  }
  return "unknown";
}

export class BybitPublicAdapter {
  readonly #products: readonly BybitPublicProduct[];
  readonly #collectorRunId: string;
  readonly #depth: number;
  readonly #maxRecentTradeIds: number;
  readonly #staleAfterMs: number;
  readonly #runtimes = new Map<BybitPublicProduct, ProductRuntime>();
  #connectionId: string | undefined;
  #active = false;
  #everConnected = false;
  #reconnectCount = 0;
  #nextIngestSequence: number;
  #lastReceivedTimestampMs: number | undefined;
  #subscriptionReady = false;
  #pongCount = 0;

  constructor(options: BybitPublicAdapterOptions) {
    assertBybitProductSet(options.products);
    this.#products = [...options.products];
    this.#collectorRunId = collectorRunIdSchema.parse(
      options.collectorRunId
    );
    this.#depth = positiveSafeIntegerSchema.max(1_000).parse(options.depth);
    this.#maxRecentTradeIds = positiveSafeIntegerSchema
      .max(100_000)
      .parse(options.maxRecentTradeIds);
    this.#staleAfterMs = positiveSafeIntegerSchema.parse(
      options.staleAfterMs
    );
    this.#nextIngestSequence = nonNegativeSafeIntegerSchema.parse(
      options.initialIngestSequence ?? 0
    );
    const maxTrackedLevelsPerSide = positiveSafeIntegerSchema
      .max(20_000)
      .parse(options.maxTrackedLevelsPerSide);

    for (const product of this.#products) {
      this.#runtimes.set(
        product,
        this.#newRuntime(product, maxTrackedLevelsPerSide)
      );
    }
  }

  beginConnection(
    connectionId: string,
    receivedTimestampMs: number
  ): readonly FeedStatusEvent[] {
    if (this.#active) {
      throw new Error("Bybit adapter connection is already active");
    }
    this.#connectionId = connectionIdSchema.parse(connectionId);
    const received = utcEpochMillisecondsSchema.parse(receivedTimestampMs);
    if (this.#everConnected) {
      this.#reconnectCount += 1;
    }
    this.#everConnected = true;
    this.#active = true;
    this.#lastReceivedTimestampMs = received;
    this.#subscriptionReady = false;
    this.#pongCount = 0;

    return this.#products.map((product) => {
      const runtime = this.#runtime(product);
      runtime.book.reset();
      runtime.recentTradeIds.clear();
      runtime.recentTradeIdQueue.splice(0);
      runtime.bookReady = false;
      runtime.metadataReady = false;
      runtime.tradeSeen = false;
      runtime.marketStatus = undefined;
      runtime.gapped = false;
      runtime.state = "connecting";
      runtime.lastBookUpdateId = undefined;
      runtime.lastBookCrossSequence = undefined;
      runtime.lastTradeSequence = undefined;
      runtime.lastMarketReceivedTimestampMs = undefined;
      runtime.lastGoodVenueSequence = null;
      return this.#feedStatus(
        runtime,
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
    this.#subscriptionReady = false;
    return this.#products.map((product) => {
      const runtime = this.#runtime(product);
      runtime.book.reset();
      runtime.recentTradeIds.clear();
      runtime.recentTradeIdQueue.splice(0);
      runtime.bookReady = false;
      runtime.metadataReady = false;
      runtime.tradeSeen = false;
      runtime.marketStatus = undefined;
      runtime.lastBookUpdateId = undefined;
      runtime.lastBookCrossSequence = undefined;
      runtime.lastTradeSequence = undefined;
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

  ingestInstrument(
    expectedProduct: BybitPublicProduct,
    input: unknown,
    receivedTimestampMs: number
  ): readonly NormalizedEvent[] {
    this.#assertActive();
    assertBybitPublicProduct(expectedProduct);
    const runtime = this.#runtime(expectedProduct);
    const received = utcEpochMillisecondsSchema.parse(receivedTimestampMs);
    if (this.#recordReceived(received)) {
      return this.#gapAll(
        "receive_timestamp_moved_backwards",
        null,
        received
      );
    }
    if (runtime.gapped) {
      return [];
    }

    let response;
    try {
      response = bybitInstrumentResponseSchema.parse(input);
      if (response.result.list[0]?.symbol !== expectedProduct) {
        throw new Error(
          `instrument response did not match ${expectedProduct}`
        );
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return this.#gapProduct(
        runtime,
        `malformed_instrument: ${reason}`.slice(0, 512),
        null,
        received
      );
    }

    const product = response.result.list[0]!;
    const status = metadataStatus(product);
    runtime.metadataReady = true;
    runtime.marketStatus = status;
    const output: NormalizedEvent[] = [
      normalizeBybitProductMetadata(product, {
        receivedTimestampMs: received,
        ingestSequence: this.#takeIngestSequence(),
        collectorRunId: this.#collectorRunId,
        connectionId: this.#connectionId!,
        serverTimeMs: response.time
      }),
      marketStatusEventSchema.parse({
        ...this.#commonEnvelope(
          runtime.product,
          response.time,
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
    ];
    output.push(
      ...this.#reevaluateReadiness(
        runtime,
        response.time,
        received,
        runtime.lastGoodVenueSequence,
        "rest"
      )
    );
    return output;
  }

  ingest(
    input: string | unknown,
    receivedTimestampMs: number
  ): readonly NormalizedEvent[] {
    this.#assertActive();
    const received = utcEpochMillisecondsSchema.parse(receivedTimestampMs);
    if (this.#recordReceived(received)) {
      return this.#gapAll(
        "receive_timestamp_moved_backwards",
        null,
        received
      );
    }

    let message;
    try {
      message = parseBybitPublicMessage(input);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return this.#gapAll(
        `malformed_message: ${reason}`.slice(0, 512),
        null,
        received
      );
    }

    if ("op" in message && message.op === "subscribe") {
      const response = bybitSubscriptionResponseSchema.parse(message);
      if (!response.success || response.ret_msg !== "subscribe") {
        return this.#gapAll(
          `subscription_failed:${response.ret_msg}`.slice(0, 512),
          null,
          received
        );
      }
      this.#subscriptionReady = true;
      return this.#products.flatMap((product) => {
        const runtime = this.#runtime(product);
        return this.#reevaluateReadiness(
          runtime,
          null,
          received,
          runtime.lastGoodVenueSequence,
          "websocket"
        );
      });
    }

    if (
      "ret_msg" in message &&
      message.ret_msg === "pong"
    ) {
      const response = bybitPongResponseSchema.parse(message);
      if (!response.success) {
        return this.#gapAll("pong_failed", null, received);
      }
      this.#pongCount += 1;
      return [];
    }

    if (
      "topic" in message &&
      typeof message.topic === "string" &&
      message.topic.startsWith("orderbook.")
    ) {
      const event = bybitOrderbookMessageSchema.parse(message);
      if (!this.#runtimes.has(event.data.s)) {
        return this.#gapAll(
          `unconfigured_product:${event.data.s}`,
          `${event.data.u}:${event.data.seq}`,
          received
        );
      }
      return this.#handleOrderbook(event, received);
    }

    if (
      "topic" in message &&
      typeof message.topic === "string" &&
      message.topic.startsWith("publicTrade.")
    ) {
      const event = bybitPublicTradeMessageSchema.parse(message);
      const product = event.data[0]!.s;
      if (!this.#runtimes.has(product)) {
        return this.#gapAll(
          `unconfigured_product:${product}`,
          String(event.data[0]!.seq),
          received
        );
      }
      return this.#handleTrades(event, received);
    }
    return [];
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

  diagnostics(): BybitAdapterDiagnostics {
    return {
      active: this.#active,
      connectionId: this.#connectionId ?? null,
      subscriptionReady: this.#subscriptionReady,
      pongCount: this.#pongCount,
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
          lastBookUpdateId:
            runtime.lastBookUpdateId === undefined
              ? null
              : String(runtime.lastBookUpdateId),
          lastBookCrossSequence:
            runtime.lastBookCrossSequence === undefined
              ? null
              : String(runtime.lastBookCrossSequence),
          lastTradeSequence:
            runtime.lastTradeSequence === undefined
              ? null
              : String(runtime.lastTradeSequence),
          lastGoodVenueSequence: runtime.lastGoodVenueSequence,
          gapCount: runtime.gapCount,
          crossedBookCount: runtime.crossedBookCount,
          snapshotCount: runtime.snapshotCount
        };
      })
    };
  }

  #handleOrderbook(
    message: BybitOrderbookMessage,
    received: number
  ): readonly NormalizedEvent[] {
    const runtime = this.#runtime(message.data.s);
    if (runtime.gapped) {
      return [];
    }
    const expectedTopic =
      `orderbook.${BYBIT_ORDERBOOK_DEPTH}.${runtime.product}`;
    const venueSequence = `${message.data.u}:${message.data.seq}`;
    if (message.topic !== expectedTopic) {
      return this.#gapAll(
        "topic_event_mismatch",
        venueSequence,
        received
      );
    }

    if (message.type === "snapshot") {
      const wasReady = runtime.bookReady;
      try {
        runtime.book.applySnapshot(message);
      } catch (error) {
        if (
          error instanceof BybitBookIntegrityError &&
          error.code === "crossed_book"
        ) {
          runtime.crossedBookCount += 1;
        }
        const reason =
          error instanceof BybitBookIntegrityError
            ? `book_${error.code}`
            : "invalid_orderbook_snapshot";
        return this.#gapProduct(
          runtime,
          reason,
          venueSequence,
          received
        );
      }
      runtime.bookReady = true;
      runtime.lastBookUpdateId = message.data.u;
      runtime.lastBookCrossSequence = message.data.seq;
      runtime.lastMarketReceivedTimestampMs = received;
      runtime.lastGoodVenueSequence = venueSequence;
      runtime.snapshotCount += 1;
      const top = runtime.book.top(this.#depth);
      const output: NormalizedEvent[] = [
        bookCheckpointEventSchema.parse({
          ...this.#commonEnvelope(
            runtime.product,
            message.cts,
            received,
            venueSequence,
            "websocket"
          ),
          eventType: "book_checkpoint",
          payload: {
            bids: top.bids,
            asks: top.asks,
            depth: this.#depth,
            checksum: null,
            isRecovery:
              this.#reconnectCount > 0 ||
              wasReady ||
              message.data.u === 1
          }
        })
      ];
      output.push(
        ...this.#reevaluateReadiness(
          runtime,
          message.cts,
          received,
          venueSequence,
          "websocket"
        )
      );
      return output;
    }

    const lastUpdateId = runtime.lastBookUpdateId;
    const lastCrossSequence = runtime.lastBookCrossSequence;
    if (
      !runtime.bookReady ||
      lastUpdateId === undefined ||
      lastCrossSequence === undefined
    ) {
      return this.#gapProduct(
        runtime,
        "orderbook_delta_before_snapshot",
        venueSequence,
        received
      );
    }
    if (message.data.u !== lastUpdateId + 1) {
      return this.#gapProduct(
        runtime,
        message.data.u <= lastUpdateId
          ? "orderbook_update_out_of_order"
          : `orderbook_update_gap:${lastUpdateId}->${message.data.u}`,
        venueSequence,
        received
      );
    }
    if (message.data.seq <= lastCrossSequence) {
      return this.#gapProduct(
        runtime,
        "orderbook_cross_sequence_out_of_order",
        venueSequence,
        received
      );
    }

    try {
      runtime.book.applyDelta(message);
    } catch (error) {
      if (
        error instanceof BybitBookIntegrityError &&
        error.code === "crossed_book"
      ) {
        runtime.crossedBookCount += 1;
      }
      const reason =
        error instanceof BybitBookIntegrityError
          ? `book_${error.code}`
          : "invalid_orderbook_delta";
      return this.#gapProduct(
        runtime,
        reason,
        venueSequence,
        received
      );
    }

    runtime.lastBookUpdateId = message.data.u;
    runtime.lastBookCrossSequence = message.data.seq;
    runtime.lastMarketReceivedTimestampMs = received;
    runtime.lastGoodVenueSequence = venueSequence;
    const output: NormalizedEvent[] = [
      bookDeltaEventSchema.parse({
        ...this.#commonEnvelope(
          runtime.product,
          message.cts,
          received,
          venueSequence,
          "websocket"
        ),
        eventType: "book_delta",
        payload: {
          updateSemantics: "absolute",
          firstVenueSequence: String(message.data.u),
          lastVenueSequence: String(message.data.u),
          changes: [
            ...message.data.b.map(([price, quantity]) => ({
              side: "bid" as const,
              price: normalizeDecimalString(price),
              quantity: normalizeDecimalString(quantity)
            })),
            ...message.data.a.map(([price, quantity]) => ({
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
        message.cts,
        received,
        venueSequence,
        "websocket"
      )
    );
    return output;
  }

  #handleTrades(
    message: BybitPublicTradeMessage,
    received: number
  ): readonly NormalizedEvent[] {
    const product = message.data[0]!.s;
    const runtime = this.#runtime(product);
    if (runtime.gapped) {
      return [];
    }
    if (message.topic !== `publicTrade.${product}`) {
      return this.#gapAll(
        "topic_event_mismatch",
        String(message.data[0]!.seq),
        received
      );
    }
    if (message.data.some((trade) => trade.s !== product)) {
      return this.#gapProduct(
        runtime,
        "mixed_trade_products",
        String(message.data[0]!.seq),
        received
      );
    }

    let previousSequence = runtime.lastTradeSequence;
    let previousTimestamp: number | undefined;
    const messageIds = new Set<string>();
    for (const trade of message.data) {
      if (
        previousSequence !== undefined &&
        trade.seq < previousSequence
      ) {
        return this.#gapProduct(
          runtime,
          "trade_sequence_out_of_order",
          String(trade.seq),
          received
        );
      }
      if (
        previousTimestamp !== undefined &&
        trade.T < previousTimestamp
      ) {
        return this.#gapProduct(
          runtime,
          "trade_timestamp_out_of_order",
          String(trade.seq),
          received
        );
      }
      if (
        messageIds.has(trade.i) ||
        runtime.recentTradeIds.has(trade.i)
      ) {
        return this.#gapProduct(
          runtime,
          "duplicate_trade_id",
          `${trade.seq}:${trade.i}`,
          received
        );
      }
      messageIds.add(trade.i);
      previousSequence = trade.seq;
      previousTimestamp = trade.T;
    }

    const output: NormalizedEvent[] = [];
    for (const trade of message.data) {
      output.push(
        tradeEventSchema.parse({
          ...this.#commonEnvelope(
            runtime.product,
            trade.T,
            received,
            `${trade.seq}:${trade.i}`,
            "websocket"
          ),
          eventType: "trade",
          payload: {
            tradeId: trade.i,
            price: normalizeDecimalString(trade.p),
            quantity: normalizeDecimalString(trade.v),
            aggressorSide: trade.S === "Buy" ? "buy" : "sell"
          }
        })
      );
      this.#rememberTradeId(runtime, trade.i);
    }
    runtime.lastTradeSequence = previousSequence;
    runtime.tradeSeen = true;
    runtime.lastMarketReceivedTimestampMs = received;
    runtime.lastGoodVenueSequence =
      runtime.lastBookUpdateId === undefined ||
      runtime.lastBookCrossSequence === undefined
        ? String(previousSequence)
        : `${runtime.lastBookUpdateId}:${runtime.lastBookCrossSequence}`;
    output.push(
      ...this.#reevaluateReadiness(
        runtime,
        message.ts,
        received,
        runtime.lastGoodVenueSequence,
        "websocket"
      )
    );
    return output;
  }

  #rememberTradeId(runtime: ProductRuntime, tradeId: string): void {
    runtime.recentTradeIds.add(tradeId);
    runtime.recentTradeIdQueue.push(tradeId);
    if (runtime.recentTradeIdQueue.length > this.#maxRecentTradeIds) {
      const removed = runtime.recentTradeIdQueue.shift();
      if (removed !== undefined) {
        runtime.recentTradeIds.delete(removed);
      }
    }
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
    if (
      this.#subscriptionReady &&
      runtime.bookReady &&
      runtime.metadataReady
    ) {
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
    runtime.recentTradeIds.clear();
    runtime.recentTradeIdQueue.splice(0);
    runtime.bookReady = false;
    runtime.lastBookUpdateId = undefined;
    runtime.lastBookCrossSequence = undefined;
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
    product: BybitPublicProduct,
    sourceTimestampMs: number | null,
    receivedTimestampMs: number,
    venueSequence: string | null,
    source: "websocket" | "rest"
  ): Record<string, unknown> {
    return {
      schemaVersion: 1,
      venue: "bybit",
      product: bybitCanonicalProduct(product),
      nativeProduct: product,
      sourceTimestampMs,
      receivedTimestampMs,
      ingestSequence: this.#takeIngestSequence(),
      collectorRunId: this.#collectorRunId,
      connectionId: this.#connectionId,
      venueSequence,
      source
    };
  }

  #takeIngestSequence(): number {
    const value = nonNegativeSafeIntegerSchema.parse(
      this.#nextIngestSequence
    );
    if (value === Number.MAX_SAFE_INTEGER) {
      throw new Error("Bybit ingest sequence exhausted");
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
      throw new Error("Bybit adapter connection is not active");
    }
  }

  #runtime(product: BybitPublicProduct): ProductRuntime {
    const runtime = this.#runtimes.get(product);
    if (runtime === undefined) {
      throw new Error(`Unconfigured Bybit product: ${product}`);
    }
    return runtime;
  }

  #newRuntime(
    product: BybitPublicProduct,
    maxTrackedLevelsPerSide: number
  ): ProductRuntime {
    return {
      product,
      book: new BybitLevel2Book(maxTrackedLevelsPerSide),
      recentTradeIds: new Set(),
      recentTradeIdQueue: [],
      bookReady: false,
      metadataReady: false,
      tradeSeen: false,
      marketStatus: undefined,
      gapped: false,
      state: "stopped",
      lastBookUpdateId: undefined,
      lastBookCrossSequence: undefined,
      lastTradeSequence: undefined,
      lastMarketReceivedTimestampMs: undefined,
      lastGoodVenueSequence: null,
      gapCount: 0,
      crossedBookCount: 0,
      snapshotCount: 0
    };
  }
}
