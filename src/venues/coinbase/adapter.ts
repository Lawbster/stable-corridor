import {
  bookCheckpointEventSchema,
  bookDeltaEventSchema,
  feedStatusEventSchema,
  marketStatusEventSchema,
  tradeContinuityEventSchema,
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
  CoinbaseBookIntegrityError,
  CoinbaseLevel2Book
} from "./book.js";
import {
  assertCoinbasePublicProduct,
  type CoinbasePublicProduct
} from "./constants.js";
import {
  coinbaseHeartbeatsEnvelopeSchema,
  coinbaseLevel2EnvelopeSchema,
  coinbaseMarketTradesEnvelopeSchema,
  coinbaseStatusEnvelopeSchema,
  parseCoinbaseAdvancedEnvelope,
  type CoinbaseLevel2Envelope,
  type CoinbaseMarketTrade,
  type CoinbaseMarketTradesEnvelope,
  type CoinbaseStatusEnvelope
} from "./schemas.js";
import {
  latestCoinbaseTimestamp,
  parseCoinbaseTimestamp
} from "./time.js";

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
  readonly product: CoinbasePublicProduct;
  readonly book: CoinbaseLevel2Book;
  bookReady: boolean;
  tradeReady: boolean;
  statusReady: boolean;
  marketStatus: string | undefined;
  gapped: boolean;
  state: FeedState;
  lastTradeId: bigint | undefined;
  lastGoodVenueSequence: string | null;
  gapCount: number;
  crossedBookCount: number;
  repeatedTradeSnapshotCount: number;
  nonAdjacentTradeIdCount: number;
  ignoredTradeCount: number;
}

export interface CoinbasePublicAdapterOptions {
  readonly products: readonly CoinbasePublicProduct[];
  readonly collectorRunId: string;
  readonly depth: number;
  readonly maxTrackedLevelsPerSide: number;
  readonly staleAfterMs: number;
  readonly initialIngestSequence?: number;
}

export interface CoinbaseProductDiagnostics {
  readonly product: CoinbasePublicProduct;
  readonly state: FeedState;
  readonly bookReady: boolean;
  readonly tradeReady: boolean;
  readonly statusReady: boolean;
  readonly marketStatus: string | null;
  readonly lastTradeId: string | null;
  readonly lastGoodVenueSequence: string | null;
  readonly gapCount: number;
  readonly crossedBookCount: number;
  readonly repeatedTradeSnapshotCount: number;
  readonly nonAdjacentTradeIdCount: number;
  readonly ignoredTradeCount: number;
}

export interface CoinbaseAdapterDiagnostics {
  readonly active: boolean;
  readonly connectionId: string | null;
  readonly lastSequenceNumber: number | null;
  readonly lastReceivedTimestampMs: number | null;
  readonly reconnectCount: number;
  readonly products: readonly CoinbaseProductDiagnostics[];
}

function tradeIdValue(trade: CoinbaseMarketTrade): bigint {
  return BigInt(trade.trade_id);
}

function makerSideToAggressorSide(
  makerSide: CoinbaseMarketTrade["side"]
): "buy" | "sell" {
  return makerSide === "BUY" ? "sell" : "buy";
}

function sameCoinbaseTrade(
  left: CoinbaseMarketTrade,
  right: CoinbaseMarketTrade
): boolean {
  return (
    left.trade_id === right.trade_id &&
    left.product_id === right.product_id &&
    left.price === right.price &&
    left.size === right.size &&
    left.time === right.time &&
    left.side === right.side
  );
}

export class CoinbasePublicAdapter {
  readonly #products: readonly CoinbasePublicProduct[];
  readonly #collectorRunId: string;
  readonly #depth: number;
  readonly #staleAfterMs: number;
  readonly #runtimes = new Map<CoinbasePublicProduct, ProductRuntime>();
  #connectionId: string | undefined;
  #active = false;
  #everConnected = false;
  #reconnectCount = 0;
  #nextIngestSequence: number;
  #lastSequenceNumber: number | undefined;
  #lastReceivedTimestampMs: number | undefined;
  #heartbeatCounter: bigint | undefined;
  #connectionGapped = false;

  constructor(options: CoinbasePublicAdapterOptions) {
    if (options.products.length === 0) {
      throw new Error("At least one Coinbase product is required");
    }
    if (new Set(options.products).size !== options.products.length) {
      throw new Error("Coinbase products must be unique");
    }
    for (const product of options.products) {
      assertCoinbasePublicProduct(product);
    }

    this.#products = [...options.products];
    this.#collectorRunId = collectorRunIdSchema.parse(
      options.collectorRunId
    );
    this.#depth = positiveSafeIntegerSchema.max(1_000).parse(options.depth);
    this.#staleAfterMs = positiveSafeIntegerSchema.parse(
      options.staleAfterMs
    );
    this.#nextIngestSequence = nonNegativeSafeIntegerSchema.parse(
      options.initialIngestSequence ?? 0
    );

    for (const product of this.#products) {
      this.#runtimes.set(product, {
        product,
        book: new CoinbaseLevel2Book(options.maxTrackedLevelsPerSide),
        bookReady: false,
        tradeReady: false,
        statusReady: false,
        marketStatus: undefined,
        gapped: false,
        state: "stopped",
        lastTradeId: undefined,
        lastGoodVenueSequence: null,
        gapCount: 0,
        crossedBookCount: 0,
        repeatedTradeSnapshotCount: 0,
        nonAdjacentTradeIdCount: 0,
        ignoredTradeCount: 0
      });
    }
  }

  beginConnection(
    connectionId: string,
    receivedTimestampMs: number
  ): readonly FeedStatusEvent[] {
    if (this.#active) {
      throw new Error("Coinbase adapter connection is already active");
    }

    this.#connectionId = connectionIdSchema.parse(connectionId);
    const received = utcEpochMillisecondsSchema.parse(receivedTimestampMs);
    if (this.#everConnected) {
      this.#reconnectCount += 1;
    }
    this.#everConnected = true;
    this.#active = true;
    this.#lastSequenceNumber = undefined;
    this.#lastReceivedTimestampMs = received;
    this.#heartbeatCounter = undefined;
    this.#connectionGapped = false;

    return this.#products.map((product) => {
      const runtime = this.#runtime(product);
      runtime.book.reset();
      runtime.bookReady = false;
      runtime.tradeReady = false;
      runtime.statusReady = false;
      runtime.marketStatus = undefined;
      runtime.gapped = false;
      runtime.state = "connecting";
      runtime.lastTradeId = undefined;
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
    return this.#products.map((product) => {
      const runtime = this.#runtime(product);
      runtime.book.reset();
      runtime.bookReady = false;
      runtime.tradeReady = false;
      runtime.statusReady = false;
      runtime.marketStatus = undefined;
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

  ingest(
    input: string | unknown,
    receivedTimestampMs: number
  ): readonly NormalizedEvent[] {
    if (!this.#active || this.#connectionId === undefined) {
      throw new Error("Coinbase adapter connection is not active");
    }
    const received = utcEpochMillisecondsSchema.parse(receivedTimestampMs);
    if (
      this.#lastReceivedTimestampMs !== undefined &&
      received < this.#lastReceivedTimestampMs
    ) {
      return this.#gapAll(
        "receive_timestamp_moved_backwards",
        null,
        received
      );
    }
    this.#lastReceivedTimestampMs = received;

    let message;
    try {
      message = parseCoinbaseAdvancedEnvelope(input);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return this.#gapAll(
        `malformed_message: ${reason}`.slice(0, 512),
        null,
        received
      );
    }

    const sequenceNumber = message.sequence_num;
    if (
      this.#lastSequenceNumber !== undefined &&
      sequenceNumber !== this.#lastSequenceNumber + 1
    ) {
      const reason =
        sequenceNumber <= this.#lastSequenceNumber
          ? "out_of_order_sequence"
          : `sequence_gap:${this.#lastSequenceNumber}->${sequenceNumber}`;
      return this.#gapAll(reason, String(sequenceNumber), received);
    }
    this.#lastSequenceNumber = sequenceNumber;

    if (this.#connectionGapped) {
      return [];
    }

    try {
      switch (message.channel) {
        case "l2_data":
          return this.#handleLevel2(
            coinbaseLevel2EnvelopeSchema.parse(message),
            received
          );
        case "market_trades":
          return this.#handleMarketTrades(
            coinbaseMarketTradesEnvelopeSchema.parse(message),
            received
          );
        case "heartbeats":
          return this.#handleHeartbeat(
            coinbaseHeartbeatsEnvelopeSchema.parse(message),
            received
          );
        case "status":
          return this.#handleStatus(
            coinbaseStatusEnvelopeSchema.parse(message),
            received
          );
        default:
          return [];
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return this.#gapAll(
        `message_processing_error: ${reason}`.slice(0, 512),
        String(sequenceNumber),
        received
      );
    }
  }

  checkStaleness(nowTimestampMs: number): readonly FeedStatusEvent[] {
    const now = utcEpochMillisecondsSchema.parse(nowTimestampMs);
    if (
      !this.#active ||
      this.#lastReceivedTimestampMs === undefined ||
      now - this.#lastReceivedTimestampMs <= this.#staleAfterMs
    ) {
      return [];
    }

    const events: FeedStatusEvent[] = [];
    for (const product of this.#products) {
      const runtime = this.#runtime(product);
      if (runtime.state === "stale" || runtime.gapped) {
        continue;
      }
      runtime.state = "stale";
      events.push(
        this.#feedStatus(
          runtime,
          "stale",
          false,
          `no_message_for_${now - this.#lastReceivedTimestampMs}ms`,
          runtime.lastGoodVenueSequence,
          now
        )
      );
    }
    return events;
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
        runtime.gapped
      ) {
        return [];
      }
      const top = runtime.book.top(this.#depth);
      return [
        bookCheckpointEventSchema.parse({
          ...this.#commonEnvelope(
            runtime.product,
            null,
            received,
            runtime.lastGoodVenueSequence
          ),
          eventType: "book_checkpoint",
          payload: {
            bids: top.bids,
            asks: top.asks,
            depth: this.#depth,
            checksum: null,
            isRecovery: false
          }
        })
      ];
    });
  }

  diagnostics(): CoinbaseAdapterDiagnostics {
    return {
      active: this.#active,
      connectionId: this.#connectionId ?? null,
      lastSequenceNumber: this.#lastSequenceNumber ?? null,
      lastReceivedTimestampMs: this.#lastReceivedTimestampMs ?? null,
      reconnectCount: this.#reconnectCount,
      products: this.#products.map((product) => {
        const runtime = this.#runtime(product);
        return {
          product,
          state: runtime.state,
          bookReady: runtime.bookReady,
          tradeReady: runtime.tradeReady,
          statusReady: runtime.statusReady,
          marketStatus: runtime.marketStatus ?? null,
          lastTradeId:
            runtime.lastTradeId === undefined
              ? null
              : runtime.lastTradeId.toString(),
          lastGoodVenueSequence: runtime.lastGoodVenueSequence,
          gapCount: runtime.gapCount,
          crossedBookCount: runtime.crossedBookCount,
          repeatedTradeSnapshotCount:
            runtime.repeatedTradeSnapshotCount,
          nonAdjacentTradeIdCount: runtime.nonAdjacentTradeIdCount,
          ignoredTradeCount: runtime.ignoredTradeCount
        };
      })
    };
  }

  #handleLevel2(
    message: CoinbaseLevel2Envelope,
    received: number
  ): readonly NormalizedEvent[] {
    const output: NormalizedEvent[] = [];
    const venueSequence = String(message.sequence_num);

    for (const event of message.events) {
      const runtime = this.#runtime(event.product_id);
      if (runtime.gapped) {
        continue;
      }

      try {
        if (event.type === "snapshot") {
          runtime.book.applySnapshot(event.updates);
          runtime.bookReady = true;
          runtime.lastGoodVenueSequence = venueSequence;
          const top = runtime.book.top(this.#depth);
          output.push(
            bookCheckpointEventSchema.parse({
              ...this.#commonEnvelope(
                runtime.product,
                latestCoinbaseTimestamp(
                  event.updates.map((update) => update.event_time),
                  message.timestamp
                ),
                received,
                venueSequence
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
          );
          output.push(
            ...this.#reevaluateReadiness(
              runtime,
              parseCoinbaseTimestamp(message.timestamp),
              received,
              venueSequence
            )
          );
          continue;
        }

        if (!runtime.bookReady) {
          output.push(
            ...this.#gapProduct(
              runtime,
              "level2_update_before_snapshot",
              venueSequence,
              received
            )
          );
          continue;
        }

        runtime.book.applyUpdate(event.updates);
        runtime.lastGoodVenueSequence = venueSequence;
        output.push(
          bookDeltaEventSchema.parse({
            ...this.#commonEnvelope(
              runtime.product,
              latestCoinbaseTimestamp(
                event.updates.map((update) => update.event_time),
                message.timestamp
              ),
              received,
              venueSequence
            ),
            eventType: "book_delta",
            payload: {
              updateSemantics: "absolute",
              firstVenueSequence: venueSequence,
              lastVenueSequence: venueSequence,
              changes: event.updates.map((update) => ({
                side: update.side === "bid" ? "bid" : "ask",
                price: normalizeDecimalString(update.price_level),
                quantity: normalizeDecimalString(update.new_quantity)
              }))
            }
          })
        );
      } catch (error) {
        if (
          error instanceof CoinbaseBookIntegrityError &&
          error.code === "crossed_book"
        ) {
          runtime.crossedBookCount += 1;
        }
        const reason =
          error instanceof CoinbaseBookIntegrityError
            ? `book_${error.code}`
            : "invalid_level2_message";
        output.push(
          ...this.#gapProduct(
            runtime,
            reason,
            venueSequence,
            received
          )
        );
      }
    }

    return output;
  }

  #handleMarketTrades(
    message: CoinbaseMarketTradesEnvelope,
    received: number
  ): readonly NormalizedEvent[] {
    const output: NormalizedEvent[] = [];

    for (const event of message.events) {
      const grouped = new Map<
        CoinbasePublicProduct,
        CoinbaseMarketTrade[]
      >();
      for (const trade of event.trades) {
        const trades = grouped.get(trade.product_id) ?? [];
        trades.push(trade);
        grouped.set(trade.product_id, trades);
      }

      for (const [product, trades] of grouped) {
        const runtime = this.#runtime(product);
        if (runtime.gapped) {
          continue;
        }
        const sorted = [...trades].sort((left, right) => {
          const leftId = tradeIdValue(left);
          const rightId = tradeIdValue(right);
          return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
        });
        const unique: CoinbaseMarketTrade[] = [];
        let duplicateTradeCount = 0;
        let conflictingDuplicate = false;
        for (const trade of sorted) {
          const previous = unique.at(-1);
          if (
            previous !== undefined &&
            previous.trade_id === trade.trade_id
          ) {
            duplicateTradeCount += 1;
            if (!sameCoinbaseTrade(previous, trade)) {
              conflictingDuplicate = true;
              break;
            }
            continue;
          }
          unique.push(trade);
        }
        if (conflictingDuplicate) {
          output.push(
            ...this.#gapProduct(
              runtime,
              "conflicting_duplicate_trade_id",
              String(message.sequence_num),
              received
            )
          );
          continue;
        }

        const previousTradeId = runtime.lastTradeId;
        let repeatedSnapshotReason: string | undefined;

        if (event.type === "snapshot" && runtime.tradeReady) {
          if (previousTradeId === undefined) {
            output.push(
              ...this.#gapProduct(
                runtime,
                "trade_snapshot_without_last_trade_id",
                String(message.sequence_num),
                received
              )
            );
            continue;
          }
          runtime.repeatedTradeSnapshotCount += 1;
        }

        if (event.type === "update" && !runtime.tradeReady) {
          output.push(
            ...this.#gapProduct(
              runtime,
              "trade_update_before_snapshot",
              String(message.sequence_num),
              received
            )
          );
          continue;
        }

        const accepted =
          previousTradeId === undefined
            ? unique
            : unique.filter(
                (trade) => tradeIdValue(trade) > previousTradeId
              );
        const overlapTradeCount = unique.length - accepted.length;
        let comparisonId = previousTradeId;
        let nonAdjacentIdObserved = false;
        for (const trade of accepted) {
          const currentId = tradeIdValue(trade);
          if (
            comparisonId !== undefined &&
            currentId !== comparisonId + 1n
          ) {
            nonAdjacentIdObserved = true;
          }
          comparisonId = currentId;
        }
        runtime.ignoredTradeCount +=
          overlapTradeCount + duplicateTradeCount;
        if (nonAdjacentIdObserved) {
          runtime.nonAdjacentTradeIdCount += 1;
        }
        if (event.type === "snapshot" && previousTradeId !== undefined) {
          repeatedSnapshotReason =
            accepted.length === 0
              ? "repeated_trade_snapshot_ignored"
              : "repeated_trade_snapshot_reconciled";
        }

        for (const trade of accepted) {
          output.push(
            tradeEventSchema.parse({
              ...this.#commonEnvelope(
                runtime.product,
                parseCoinbaseTimestamp(trade.time, "Coinbase trade time"),
                received,
                `${message.sequence_num}:${trade.trade_id}`
              ),
              eventType: "trade",
              payload: {
                tradeId: trade.trade_id,
                price: normalizeDecimalString(trade.price),
                quantity: normalizeDecimalString(trade.size),
                aggressorSide: makerSideToAggressorSide(trade.side)
              }
            })
          );
        }

        if (accepted.length > 0) {
          runtime.lastTradeId = tradeIdValue(accepted.at(-1)!);
        }
        runtime.tradeReady = true;
        runtime.lastGoodVenueSequence = String(message.sequence_num);
        const sourceTimestampMs = parseCoinbaseTimestamp(
          message.timestamp
        );
        if (
          repeatedSnapshotReason !== undefined ||
          overlapTradeCount > 0 ||
          duplicateTradeCount > 0 ||
          nonAdjacentIdObserved
        ) {
          output.push(
            tradeContinuityEventSchema.parse({
              ...this.#commonEnvelope(
                runtime.product,
                sourceTimestampMs,
                received,
                String(message.sequence_num)
              ),
              eventType: "trade_continuity",
              payload: {
                messageType: event.type,
                previousTradeId:
                  previousTradeId?.toString() ?? null,
                firstObservedTradeId: unique[0]!.trade_id,
                lastObservedTradeId: unique.at(-1)!.trade_id,
                firstAcceptedTradeId:
                  accepted[0]?.trade_id ?? null,
                lastAcceptedTradeId:
                  accepted.at(-1)?.trade_id ?? null,
                acceptedTradeCount: accepted.length,
                overlapTradeCount,
                duplicateTradeCount,
                nonAdjacentIdObserved,
                observedAtMs: received
              }
            })
          );
        }
        if (repeatedSnapshotReason !== undefined) {
          output.push(
            ...this.#reevaluateReadiness(
              runtime,
              sourceTimestampMs,
              received,
              String(message.sequence_num)
            )
          );
          output.push(
            this.#feedStatus(
              runtime,
              runtime.state,
              runtime.state === "healthy",
              repeatedSnapshotReason,
              String(message.sequence_num),
              received,
              sourceTimestampMs
            )
          );
          continue;
        }
        output.push(
          ...this.#reevaluateReadiness(
            runtime,
            sourceTimestampMs,
            received,
            String(message.sequence_num)
          )
        );
      }
    }

    return output;
  }

  #handleHeartbeat(
    message: ReturnType<typeof coinbaseHeartbeatsEnvelopeSchema.parse>,
    received: number
  ): readonly FeedStatusEvent[] {
    for (const event of message.events) {
      const counter = BigInt(event.heartbeat_counter);
      if (
        this.#heartbeatCounter !== undefined &&
        counter !== this.#heartbeatCounter + 1n
      ) {
        return this.#gapAll(
          "heartbeat_gap_or_out_of_order",
          String(message.sequence_num),
          received
        );
      }
      this.#heartbeatCounter = counter;
    }

    const sourceTimestampMs = parseCoinbaseTimestamp(message.timestamp);
    const output: FeedStatusEvent[] = [];
    for (const product of this.#products) {
      const runtime = this.#runtime(product);
      if (runtime.gapped) {
        continue;
      }
      runtime.lastGoodVenueSequence = String(message.sequence_num);
      output.push(
        ...this.#reevaluateReadiness(
          runtime,
          sourceTimestampMs,
          received,
          String(message.sequence_num)
        )
      );
    }
    return output;
  }

  #handleStatus(
    message: CoinbaseStatusEnvelope,
    received: number
  ): readonly NormalizedEvent[] {
    const output: NormalizedEvent[] = [];
    const sourceTimestampMs = parseCoinbaseTimestamp(message.timestamp);
    const venueSequence = String(message.sequence_num);

    for (const event of message.events) {
      for (const product of event.products) {
        const runtime = this.#runtime(product.id);
        if (runtime.gapped) {
          continue;
        }

        const status =
          product.status === "online"
            ? "online"
            : product.status === "offline" ||
                product.status === "delisted"
              ? "offline"
              : "unknown";
        output.push(
          marketStatusEventSchema.parse({
            ...this.#commonEnvelope(
              runtime.product,
              sourceTimestampMs,
              received,
              venueSequence
            ),
            eventType: "market_status",
            payload: {
              status,
              reason:
                product.status_message.length === 0
                  ? null
                  : product.status_message,
              observedAtMs: received
            }
          })
        );
        runtime.statusReady = true;
        runtime.marketStatus = status;
        runtime.lastGoodVenueSequence = venueSequence;
        output.push(
          ...this.#reevaluateReadiness(
            runtime,
            sourceTimestampMs,
            received,
            venueSequence
          )
        );
      }
    }

    return output;
  }

  #reevaluateReadiness(
    runtime: ProductRuntime,
    sourceTimestampMs: number,
    received: number,
    venueSequence: string
  ): readonly FeedStatusEvent[] {
    if (runtime.gapped) {
      return [];
    }
    const ready =
      runtime.bookReady &&
      runtime.tradeReady &&
      runtime.statusReady &&
      this.#heartbeatCounter !== undefined;
    const marketOnline = runtime.marketStatus === "online";
    const nextState: FeedState = ready
      ? marketOnline
        ? "healthy"
        : "stopped"
      : "recovering";
    if (runtime.state === nextState) {
      return [];
    }
    runtime.state = nextState;
    return [
      this.#feedStatus(
        runtime,
        nextState,
        ready && marketOnline,
        ready
          ? marketOnline
            ? null
            : `market_status_${runtime.marketStatus ?? "unknown"}`
          : "awaiting_book_trade_status_or_heartbeat",
        venueSequence,
        received,
        sourceTimestampMs
      )
    ];
  }

  #gapAll(
    reason: string,
    venueSequence: string | null,
    received: number
  ): readonly FeedStatusEvent[] {
    this.#connectionGapped = true;
    const output: FeedStatusEvent[] = [];
    for (const product of this.#products) {
      output.push(
        ...this.#gapProduct(
          this.#runtime(product),
          reason,
          venueSequence,
          received
        )
      );
    }
    return output;
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
    runtime.gapCount += 1;
    runtime.state = "gapped";
    runtime.book.reset();
    runtime.bookReady = false;
    runtime.tradeReady = false;
    runtime.statusReady = false;
    runtime.marketStatus = undefined;
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
    receivedTimestampMs: number,
    sourceTimestampMs: number | null = null
  ): FeedStatusEvent {
    return feedStatusEventSchema.parse({
      ...this.#commonEnvelope(
        runtime.product,
        sourceTimestampMs,
        receivedTimestampMs,
        venueSequence
      ),
      eventType: "feed_status",
      payload: {
        state,
        eligibleForResearch,
        reason,
        lastGoodVenueSequence: runtime.lastGoodVenueSequence,
        observedAtMs: receivedTimestampMs
      }
    });
  }

  #commonEnvelope(
    product: CoinbasePublicProduct,
    sourceTimestampMs: number | null,
    receivedTimestampMs: number,
    venueSequence: string | null
  ): Record<string, unknown> {
    return {
      schemaVersion: 1,
      venue: "coinbase",
      product,
      nativeProduct: product,
      sourceTimestampMs,
      receivedTimestampMs,
      ingestSequence: this.#nextIngestSequence++,
      collectorRunId: this.#collectorRunId,
      connectionId: this.#connectionId,
      venueSequence,
      source: "websocket"
    };
  }

  #runtime(product: string): ProductRuntime {
    assertCoinbasePublicProduct(product);
    const runtime = this.#runtimes.get(product);
    if (runtime === undefined) {
      throw new Error(`Unexpected Coinbase product: ${product}`);
    }
    return runtime;
  }
}
