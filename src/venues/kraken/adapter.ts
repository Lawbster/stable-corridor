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
  KrakenBookIntegrityError,
  KrakenLevel2Book
} from "./book.js";
import {
  assertKrakenProductSet,
  assertKrakenPublicProduct,
  krakenCanonicalProduct,
  KRAKEN_BOOK_DEPTH,
  KRAKEN_BOOK_SUBSCRIPTION_REQUEST_ID,
  KRAKEN_TRADE_SUBSCRIPTION_REQUEST_ID,
  type KrakenPublicProduct
} from "./constants.js";
import {
  krakenPairFromResponse,
  normalizeKrakenProductMetadata
} from "./metadata.js";
import {
  krakenAssetPairsResponseSchema,
  krakenBookMessageSchema,
  krakenHeartbeatMessageSchema,
  krakenStatusMessageSchema,
  krakenSubscriptionAckSchema,
  krakenSubscriptionErrorSchema,
  krakenTradeMessageSchema,
  parseKrakenPublicMessage,
  type KrakenAssetPairsResponse,
  type KrakenBookMessage,
  type KrakenTradeMessage
} from "./schemas.js";
import { parseKrakenTimestamp } from "./time.js";

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
  readonly product: KrakenPublicProduct;
  readonly book: KrakenLevel2Book;
  readonly recentTradeIds: Set<number>;
  readonly recentTradeIdQueue: number[];
  bookReady: boolean;
  metadataReady: boolean;
  bookAck: boolean;
  tradeAck: boolean;
  tradeSeen: boolean;
  marketStatus: string | undefined;
  gapped: boolean;
  state: FeedState;
  bookMessageOrdinal: number;
  lastBookChecksum: number | undefined;
  lastBookTimestampMs: number | undefined;
  lastTradeId: number | undefined;
  lastTradeTimestampMs: number | undefined;
  lastMarketReceivedTimestampMs: number | undefined;
  lastGoodVenueSequence: string | null;
  gapCount: number;
  checksumMismatchCount: number;
  crossedBookCount: number;
  snapshotCount: number;
}

export interface KrakenPublicAdapterOptions {
  readonly products: readonly KrakenPublicProduct[];
  readonly collectorRunId: string;
  readonly depth: number;
  readonly maxRecentTradeIds: number;
  readonly staleAfterMs: number;
  readonly initialIngestSequence?: number;
}

export interface KrakenProductDiagnostics {
  readonly product: KrakenPublicProduct;
  readonly state: FeedState;
  readonly bookReady: boolean;
  readonly metadataReady: boolean;
  readonly bookAck: boolean;
  readonly tradeAck: boolean;
  readonly tradeSeen: boolean;
  readonly marketStatus: string | null;
  readonly bookMessageOrdinal: number;
  readonly lastTradeId: string | null;
  readonly lastGoodVenueSequence: string | null;
  readonly gapCount: number;
  readonly checksumMismatchCount: number;
  readonly crossedBookCount: number;
  readonly snapshotCount: number;
}

export interface KrakenAdapterDiagnostics {
  readonly active: boolean;
  readonly connectionId: string | null;
  readonly systemStatus: string | null;
  readonly heartbeatCount: number;
  readonly lastReceivedTimestampMs: number | null;
  readonly reconnectCount: number;
  readonly products: readonly KrakenProductDiagnostics[];
}

function pairStatus(status: string): string {
  switch (status) {
    case "online":
      return "online";
    case "limit_only":
      return "limit_only";
    case "post_only":
      return "post_only";
    case "cancel_only":
      return "cancel_only";
    case "delisted":
    case "maintenance":
      return "offline";
    default:
      return "unknown";
  }
}

export class KrakenPublicAdapter {
  readonly #products: readonly KrakenPublicProduct[];
  readonly #collectorRunId: string;
  readonly #depth: number;
  readonly #maxRecentTradeIds: number;
  readonly #staleAfterMs: number;
  readonly #runtimes = new Map<KrakenPublicProduct, ProductRuntime>();
  #connectionId: string | undefined;
  #active = false;
  #everConnected = false;
  #reconnectCount = 0;
  #nextIngestSequence: number;
  #lastReceivedTimestampMs: number | undefined;
  #systemStatus: string | undefined;
  #heartbeatCount = 0;

  constructor(options: KrakenPublicAdapterOptions) {
    assertKrakenProductSet(options.products);
    this.#products = [...options.products];
    this.#collectorRunId = collectorRunIdSchema.parse(
      options.collectorRunId
    );
    this.#depth = positiveSafeIntegerSchema.max(1_000).parse(
      options.depth
    );
    if (this.#depth !== KRAKEN_BOOK_DEPTH) {
      throw new Error(
        `Kraken adapter depth must be ${KRAKEN_BOOK_DEPTH}`
      );
    }
    this.#maxRecentTradeIds = positiveSafeIntegerSchema
      .max(100_000)
      .parse(options.maxRecentTradeIds);
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
      throw new Error("Kraken adapter connection is already active");
    }
    this.#connectionId = connectionIdSchema.parse(connectionId);
    const received = utcEpochMillisecondsSchema.parse(receivedTimestampMs);
    if (this.#everConnected) {
      this.#reconnectCount += 1;
    }
    this.#everConnected = true;
    this.#active = true;
    this.#lastReceivedTimestampMs = received;
    this.#systemStatus = undefined;
    this.#heartbeatCount = 0;

    return this.#products.map((product) => {
      const runtime = this.#runtime(product);
      runtime.book.reset();
      runtime.recentTradeIds.clear();
      runtime.recentTradeIdQueue.splice(0);
      runtime.bookReady = false;
      runtime.metadataReady = false;
      runtime.bookAck = false;
      runtime.tradeAck = false;
      runtime.tradeSeen = false;
      runtime.marketStatus = undefined;
      runtime.gapped = false;
      runtime.state = "connecting";
      runtime.bookMessageOrdinal = 0;
      runtime.lastBookChecksum = undefined;
      runtime.lastBookTimestampMs = undefined;
      runtime.lastTradeId = undefined;
      runtime.lastTradeTimestampMs = undefined;
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
    this.#systemStatus = undefined;
    return this.#products.map((product) => {
      const runtime = this.#runtime(product);
      runtime.book.reset();
      runtime.recentTradeIds.clear();
      runtime.recentTradeIdQueue.splice(0);
      runtime.bookReady = false;
      runtime.metadataReady = false;
      runtime.bookAck = false;
      runtime.tradeAck = false;
      runtime.tradeSeen = false;
      runtime.marketStatus = undefined;
      runtime.bookMessageOrdinal = 0;
      runtime.lastBookChecksum = undefined;
      runtime.lastBookTimestampMs = undefined;
      runtime.lastTradeId = undefined;
      runtime.lastTradeTimestampMs = undefined;
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

  ingestAssetPairs(
    input: unknown,
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

    let response: KrakenAssetPairsResponse;
    try {
      response = krakenAssetPairsResponseSchema.parse(input);
      if (response.error.length > 0) {
        throw new Error(response.error.join("; "));
      }
      for (const product of this.#products) {
        krakenPairFromResponse(response, product);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return this.#gapAll(
        `malformed_asset_pairs: ${reason}`.slice(0, 512),
        null,
        received
      );
    }

    const output: NormalizedEvent[] = [];
    for (const product of this.#products) {
      const runtime = this.#runtime(product);
      if (runtime.gapped) {
        continue;
      }
      try {
        const pair = krakenPairFromResponse(response, product);
        const status = pairStatus(pair.status);
        output.push(
          normalizeKrakenProductMetadata(product, pair, {
            receivedTimestampMs: received,
            ingestSequence: this.#takeIngestSequence(),
            collectorRunId: this.#collectorRunId,
            connectionId: this.#connectionId!
          }),
          marketStatusEventSchema.parse({
            ...this.#commonEnvelope(
              product,
              null,
              received,
              null,
              "rest"
            ),
            eventType: "market_status",
            payload: {
              status,
              reason: status === "online" ? null : pair.status,
              observedAtMs: received
            }
          })
        );
        runtime.metadataReady = true;
        runtime.marketStatus = status;
        output.push(
          ...this.#reevaluateReadiness(
            runtime,
            null,
            received,
            runtime.lastGoodVenueSequence,
            "rest"
          )
        );
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : String(error);
        output.push(
          ...this.#gapProduct(
            runtime,
            `invalid_asset_pair: ${reason}`.slice(0, 512),
            null,
            received
          )
        );
      }
    }
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
      message = parseKrakenPublicMessage(input);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return this.#gapAll(
        `malformed_message: ${reason}`.slice(0, 512),
        null,
        received
      );
    }

    if ("method" in message && message.method === "subscribe") {
      if ("success" in message && message.success === false) {
        const error = krakenSubscriptionErrorSchema.parse(message);
        return this.#gapAll(
          `subscription_failed:${error.error}`.slice(0, 512),
          null,
          received
        );
      }
      return this.#handleSubscription(
        krakenSubscriptionAckSchema.parse(message),
        received
      );
    }
    if ("channel" in message && message.channel === "status") {
      const status = krakenStatusMessageSchema.parse(message);
      this.#systemStatus = status.data[0]!.system;
      return this.#products.flatMap((product) =>
        this.#reevaluateReadiness(
          this.#runtime(product),
          null,
          received,
          this.#runtime(product).lastGoodVenueSequence,
          "websocket"
        )
      );
    }
    if ("channel" in message && message.channel === "heartbeat") {
      krakenHeartbeatMessageSchema.parse(message);
      this.#heartbeatCount += 1;
      return [];
    }
    if ("channel" in message && message.channel === "book") {
      return this.#handleBook(
        krakenBookMessageSchema.parse(message),
        received
      );
    }
    if ("channel" in message && message.channel === "trade") {
      return this.#handleTrades(
        krakenTradeMessageSchema.parse(message),
        received
      );
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

  checkpoint(nowTimestampMs: number): readonly NormalizedEvent[] {
    const received = utcEpochMillisecondsSchema.parse(nowTimestampMs);
    if (!this.#active) {
      return [];
    }
    return this.#products.flatMap((product) => {
      const runtime = this.#runtime(product);
      if (
        runtime.state !== "healthy" ||
        !runtime.bookReady ||
        runtime.gapped ||
        runtime.lastBookChecksum === undefined
      ) {
        return [];
      }
      const venueSequence =
        `${runtime.bookMessageOrdinal}:${runtime.lastBookChecksum}`;
      const top = runtime.book.top(this.#depth);
      return [
        bookCheckpointEventSchema.parse({
          ...this.#commonEnvelope(
            runtime.product,
            null,
            received,
            venueSequence,
            "websocket"
          ),
          eventType: "book_checkpoint",
          payload: {
            bids: top.bids,
            asks: top.asks,
            depth: this.#depth,
            checksum: String(runtime.lastBookChecksum),
            isRecovery: false
          }
        })
      ];
    });
  }

  diagnostics(): KrakenAdapterDiagnostics {
    return {
      active: this.#active,
      connectionId: this.#connectionId ?? null,
      systemStatus: this.#systemStatus ?? null,
      heartbeatCount: this.#heartbeatCount,
      lastReceivedTimestampMs: this.#lastReceivedTimestampMs ?? null,
      reconnectCount: this.#reconnectCount,
      products: this.#products.map((product) => {
        const runtime = this.#runtime(product);
        return {
          product,
          state: runtime.state,
          bookReady: runtime.bookReady,
          metadataReady: runtime.metadataReady,
          bookAck: runtime.bookAck,
          tradeAck: runtime.tradeAck,
          tradeSeen: runtime.tradeSeen,
          marketStatus: runtime.marketStatus ?? null,
          bookMessageOrdinal: runtime.bookMessageOrdinal,
          lastTradeId:
            runtime.lastTradeId === undefined
              ? null
              : String(runtime.lastTradeId),
          lastGoodVenueSequence: runtime.lastGoodVenueSequence,
          gapCount: runtime.gapCount,
          checksumMismatchCount: runtime.checksumMismatchCount,
          crossedBookCount: runtime.crossedBookCount,
          snapshotCount: runtime.snapshotCount
        };
      })
    };
  }

  #handleSubscription(
    message: ReturnType<typeof krakenSubscriptionAckSchema.parse>,
    received: number
  ): readonly FeedStatusEvent[] {
    const runtime = this.#runtime(message.result.symbol);
    if (runtime.gapped) {
      return [];
    }
    const isBook = message.result.channel === "book";
    const expectedRequestId = isBook
      ? KRAKEN_BOOK_SUBSCRIPTION_REQUEST_ID
      : KRAKEN_TRADE_SUBSCRIPTION_REQUEST_ID;
    if (message.req_id !== expectedRequestId) {
      return this.#gapProduct(
        runtime,
        "subscription_request_id_mismatch",
        null,
        received
      );
    }
    if (
      (isBook &&
        (message.result.snapshot !== true ||
          message.result.depth !== KRAKEN_BOOK_DEPTH)) ||
      (!isBook && message.result.snapshot !== false)
    ) {
      return this.#gapProduct(
        runtime,
        "subscription_contract_mismatch",
        null,
        received
      );
    }
    if ((isBook && runtime.bookAck) || (!isBook && runtime.tradeAck)) {
      return this.#gapProduct(
        runtime,
        "duplicate_subscription_ack",
        null,
        received
      );
    }
    if (isBook) {
      runtime.bookAck = true;
    } else {
      runtime.tradeAck = true;
    }
    return this.#reevaluateReadiness(
      runtime,
      parseKrakenTimestamp(message.time_out),
      received,
      runtime.lastGoodVenueSequence,
      "websocket"
    );
  }

  #handleBook(
    message: KrakenBookMessage,
    received: number
  ): readonly NormalizedEvent[] {
    const data = message.data[0]!;
    const runtime = this.#runtime(data.symbol);
    if (runtime.gapped) {
      return [];
    }
    if (!runtime.bookAck) {
      return this.#gapProduct(
        runtime,
        "book_message_before_subscription_ack",
        null,
        received
      );
    }
    const sourceTimestampMs = parseKrakenTimestamp(data.timestamp);
    if (
      runtime.lastBookTimestampMs !== undefined &&
      sourceTimestampMs < runtime.lastBookTimestampMs
    ) {
      return this.#gapProduct(
        runtime,
        "book_timestamp_moved_backwards",
        null,
        received
      );
    }
    const nextOrdinal = runtime.bookMessageOrdinal + 1;
    const venueSequence = `${nextOrdinal}:${data.checksum}`;

    if (message.type === "snapshot") {
      const wasReady = runtime.bookReady;
      try {
        runtime.book.applySnapshot(message);
      } catch (error) {
        return this.#bookFailure(
          runtime,
          error,
          venueSequence,
          received
        );
      }
      runtime.bookReady = true;
      runtime.bookMessageOrdinal = nextOrdinal;
      runtime.lastBookChecksum = data.checksum;
      runtime.lastBookTimestampMs = sourceTimestampMs;
      runtime.lastMarketReceivedTimestampMs = received;
      runtime.lastGoodVenueSequence = venueSequence;
      runtime.snapshotCount += 1;
      const top = runtime.book.top(this.#depth);
      const output: NormalizedEvent[] = [
        bookCheckpointEventSchema.parse({
          ...this.#commonEnvelope(
            runtime.product,
            sourceTimestampMs,
            received,
            venueSequence,
            "websocket"
          ),
          eventType: "book_checkpoint",
          payload: {
            bids: top.bids,
            asks: top.asks,
            depth: this.#depth,
            checksum: String(data.checksum),
            isRecovery: this.#reconnectCount > 0 || wasReady
          }
        })
      ];
      output.push(
        ...this.#reevaluateReadiness(
          runtime,
          sourceTimestampMs,
          received,
          venueSequence,
          "websocket"
        )
      );
      return output;
    }

    if (!runtime.bookReady) {
      return this.#gapProduct(
        runtime,
        "book_update_before_snapshot",
        venueSequence,
        received
      );
    }
    let changes;
    try {
      changes = runtime.book.applyUpdate(message);
    } catch (error) {
      return this.#bookFailure(
        runtime,
        error,
        venueSequence,
        received
      );
    }
    runtime.bookMessageOrdinal = nextOrdinal;
    runtime.lastBookChecksum = data.checksum;
    runtime.lastBookTimestampMs = sourceTimestampMs;
    runtime.lastMarketReceivedTimestampMs = received;
    runtime.lastGoodVenueSequence = venueSequence;
    const output: NormalizedEvent[] = [
      bookDeltaEventSchema.parse({
        ...this.#commonEnvelope(
          runtime.product,
          sourceTimestampMs,
          received,
          venueSequence,
          "websocket"
        ),
        eventType: "book_delta",
        payload: {
          updateSemantics: "absolute",
          firstVenueSequence: venueSequence,
          lastVenueSequence: venueSequence,
          changes
        }
      })
    ];
    output.push(
      ...this.#reevaluateReadiness(
        runtime,
        sourceTimestampMs,
        received,
        venueSequence,
        "websocket"
      )
    );
    return output;
  }

  #handleTrades(
    message: KrakenTradeMessage,
    received: number
  ): readonly NormalizedEvent[] {
    const product = message.data[0]!.symbol;
    const runtime = this.#runtime(product);
    if (runtime.gapped) {
      return [];
    }
    if (!runtime.tradeAck) {
      return this.#gapProduct(
        runtime,
        "trade_message_before_subscription_ack",
        null,
        received
      );
    }
    if (message.type !== "update") {
      return this.#gapProduct(
        runtime,
        "unexpected_trade_snapshot",
        String(message.data[0]!.trade_id),
        received
      );
    }
    if (message.data.some((trade) => trade.symbol !== product)) {
      return this.#gapProduct(
        runtime,
        "mixed_trade_products",
        String(message.data[0]!.trade_id),
        received
      );
    }

    let previousId = runtime.lastTradeId;
    let previousTimestamp = runtime.lastTradeTimestampMs;
    const messageIds = new Set<number>();
    for (const trade of message.data) {
      const timestamp = parseKrakenTimestamp(trade.timestamp);
      if (previousId !== undefined && trade.trade_id <= previousId) {
        return this.#gapProduct(
          runtime,
          "trade_id_out_of_order",
          String(trade.trade_id),
          received
        );
      }
      if (
        previousTimestamp !== undefined &&
        timestamp < previousTimestamp
      ) {
        return this.#gapProduct(
          runtime,
          "trade_timestamp_out_of_order",
          String(trade.trade_id),
          received
        );
      }
      if (
        messageIds.has(trade.trade_id) ||
        runtime.recentTradeIds.has(trade.trade_id)
      ) {
        return this.#gapProduct(
          runtime,
          "duplicate_trade_id",
          String(trade.trade_id),
          received
        );
      }
      messageIds.add(trade.trade_id);
      previousId = trade.trade_id;
      previousTimestamp = timestamp;
    }

    const output: NormalizedEvent[] = [];
    for (const trade of message.data) {
      output.push(
        tradeEventSchema.parse({
          ...this.#commonEnvelope(
            runtime.product,
            parseKrakenTimestamp(trade.timestamp),
            received,
            String(trade.trade_id),
            "websocket"
          ),
          eventType: "trade",
          payload: {
            tradeId: String(trade.trade_id),
            price: normalizeDecimalString(trade.price),
            quantity: normalizeDecimalString(trade.qty),
            aggressorSide: trade.side
          }
        })
      );
      this.#rememberTradeId(runtime, trade.trade_id);
    }
    runtime.lastTradeId = previousId;
    runtime.lastTradeTimestampMs = previousTimestamp;
    runtime.tradeSeen = true;
    runtime.lastMarketReceivedTimestampMs = received;
    if (!runtime.bookReady) {
      runtime.lastGoodVenueSequence = String(previousId);
    }
    output.push(
      ...this.#reevaluateReadiness(
        runtime,
        previousTimestamp ?? null,
        received,
        runtime.lastGoodVenueSequence,
        "websocket"
      )
    );
    return output;
  }

  #bookFailure(
    runtime: ProductRuntime,
    error: unknown,
    venueSequence: string,
    received: number
  ): readonly FeedStatusEvent[] {
    if (error instanceof KrakenBookIntegrityError) {
      if (error.code === "checksum_mismatch") {
        runtime.checksumMismatchCount += 1;
      }
      if (error.code === "crossed_book") {
        runtime.crossedBookCount += 1;
      }
      return this.#gapProduct(
        runtime,
        `book_${error.code}`,
        venueSequence,
        received
      );
    }
    return this.#gapProduct(
      runtime,
      "invalid_book_message",
      venueSequence,
      received
    );
  }

  #rememberTradeId(runtime: ProductRuntime, tradeId: number): void {
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
    if (this.#systemStatus !== undefined && this.#systemStatus !== "online") {
      if (runtime.state === "stopped") {
        return [];
      }
      runtime.state = "stopped";
      return [
        this.#feedStatus(
          runtime,
          "stopped",
          false,
          `system_status_${this.#systemStatus}`,
          venueSequence,
          received,
          sourceTimestampMs,
          source
        )
      ];
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
      this.#systemStatus === "online" &&
      runtime.metadataReady &&
      runtime.bookAck &&
      runtime.tradeAck &&
      runtime.bookReady
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
    product: KrakenPublicProduct,
    sourceTimestampMs: number | null,
    receivedTimestampMs: number,
    venueSequence: string | null,
    source: "websocket" | "rest"
  ): Record<string, unknown> {
    return {
      schemaVersion: 1,
      venue: "kraken",
      product: krakenCanonicalProduct(product),
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
      throw new Error("Kraken ingest sequence exhausted");
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
      throw new Error("Kraken adapter connection is not active");
    }
  }

  #runtime(product: string): ProductRuntime {
    assertKrakenPublicProduct(product);
    const runtime = this.#runtimes.get(product);
    if (runtime === undefined) {
      throw new Error(`Unconfigured Kraken product: ${product}`);
    }
    return runtime;
  }

  #newRuntime(product: KrakenPublicProduct): ProductRuntime {
    return {
      product,
      book: new KrakenLevel2Book(this.#depth),
      recentTradeIds: new Set(),
      recentTradeIdQueue: [],
      bookReady: false,
      metadataReady: false,
      bookAck: false,
      tradeAck: false,
      tradeSeen: false,
      marketStatus: undefined,
      gapped: false,
      state: "stopped",
      bookMessageOrdinal: 0,
      lastBookChecksum: undefined,
      lastBookTimestampMs: undefined,
      lastTradeId: undefined,
      lastTradeTimestampMs: undefined,
      lastMarketReceivedTimestampMs: undefined,
      lastGoodVenueSequence: null,
      gapCount: 0,
      checksumMismatchCount: 0,
      crossedBookCount: 0,
      snapshotCount: 0
    };
  }
}
