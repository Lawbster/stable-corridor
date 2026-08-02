import { createHash, randomUUID } from "node:crypto";

import type { CollectorConfig } from "../config.js";
import type { NormalizedEvent } from "../schema/events.js";
import { canonicalStringify } from "../serialization.js";
import {
  publishCollectorHealthAtomic,
  tryPublishCollectorHealthAtomic
} from "../../health/atomic-publisher.js";
import type { CollectorHealth } from "../../health/schema.js";
import { BinancePublicAdapter } from "../../venues/binance/adapter.js";
import { binanceCanonicalProduct } from "../../venues/binance/constants.js";
import {
  fetchBinancePublicDepthSnapshot,
  fetchBinancePublicExchangeInfo
} from "../../venues/binance/metadata.js";
import { BinancePublicWebSocketSession } from "../../venues/binance/transport.js";
import { BybitPublicAdapter } from "../../venues/bybit/adapter.js";
import { bybitCanonicalProduct } from "../../venues/bybit/constants.js";
import { fetchBybitPublicInstruments } from "../../venues/bybit/metadata.js";
import { BybitPublicWebSocketSession } from "../../venues/bybit/transport.js";
import { CoinbasePublicAdapter } from "../../venues/coinbase/adapter.js";
import {
  fetchCoinbasePublicProductsMetadata,
  normalizeCoinbaseProductMetadata
} from "../../venues/coinbase/metadata.js";
import { CoinbasePublicWebSocketSession } from "../../venues/coinbase/transport.js";
import { KrakenPublicAdapter } from "../../venues/kraken/adapter.js";
import { krakenCanonicalProduct } from "../../venues/kraken/constants.js";
import { fetchKrakenPublicAssetPairs } from "../../venues/kraken/metadata.js";
import { KrakenPublicWebSocketSession } from "../../venues/kraken/transport.js";
import {
  CollectorEventSink,
  type FeedDiagnostic
} from "./event-sink.js";
import {
  measureStorage,
  storageLimitReason,
  type StorageMeasurement
} from "./storage.js";

type VenueName = "coinbase" | "binance" | "bybit" | "kraken";

interface StoppableSession {
  stop(code?: number, reason?: string): void;
}

interface ActiveSession {
  readonly session: StoppableSession;
  readonly endConnection: (
    receivedTimestampMs: number,
    reason?: string
  ) => readonly NormalizedEvent[];
}

export interface PublicCollectorRunnerOptions {
  readonly config: CollectorConfig;
  readonly commitSha?: string | null;
  readonly now?: () => number;
  readonly log?: (message: string) => void;
}

function validatedCommitSha(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value.length === 0) {
    return null;
  }
  if (!/^[0-9a-f]{7,64}$/iu.test(value)) {
    throw new Error("Invalid Stable Corridor commit SHA");
  }
  return value;
}

export class PublicCollectorRunner {
  readonly #config: CollectorConfig;
  readonly #commitSha: string | null;
  readonly #now: () => number;
  readonly #log: (message: string) => void;
  readonly #collectorRunId = randomUUID();
  readonly #startedAtMs: number;
  readonly #configHash: string;
  readonly #sink: CollectorEventSink;
  readonly #coinbase: CoinbasePublicAdapter;
  readonly #binance: BinancePublicAdapter;
  readonly #bybit: BybitPublicAdapter;
  readonly #kraken: KrakenPublicAdapter;
  readonly #sessions = new Map<VenueName, ActiveSession>();
  readonly #connectInProgress = new Set<VenueName>();
  readonly #reconnectTimers = new Map<
    VenueName,
    ReturnType<typeof setTimeout>
  >();
  readonly #venueErrors = new Map<VenueName, string>();
  #healthTimer: ReturnType<typeof setInterval> | undefined;
  #staleTimer: ReturnType<typeof setInterval> | undefined;
  #checkpointTimer: ReturnType<typeof setInterval> | undefined;
  #lastHealthScheduledAtMs: number;
  #eventLoopLagMs = 0;
  #lastStorage: StorageMeasurement = {
    dataRootBytes: 0,
    diskFreeBytes: 0
  };
  #healthRunning = false;
  #started = false;
  #stopping = false;
  #stopReason: string | undefined;
  #exitCode = 0;
  #resolveWait: (() => void) | undefined;
  readonly #waitPromise: Promise<void>;

  constructor(options: PublicCollectorRunnerOptions) {
    this.#config = options.config;
    this.#commitSha = validatedCommitSha(options.commitSha);
    this.#now = options.now ?? Date.now;
    this.#log = options.log ?? ((message) => console.log(message));
    this.#startedAtMs = this.#now();
    this.#lastHealthScheduledAtMs = this.#startedAtMs;
    this.#configHash = createHash("sha256")
      .update(canonicalStringify(this.#config))
      .digest("hex");
    this.#sink = new CollectorEventSink({
      dataRoot: this.#config.dataRoot,
      maxPartBytes: this.#config.journal.maxPartBytes,
      syncEveryAppend: this.#config.journal.syncEveryAppend
    });
    this.#coinbase = new CoinbasePublicAdapter({
      products: this.#config.coinbase.products,
      collectorRunId: this.#collectorRunId,
      depth: this.#config.book.depth,
      maxTrackedLevelsPerSide:
        this.#config.coinbase.maxTrackedLevelsPerSide,
      staleAfterMs: this.#config.coinbase.staleAfterMs
    });
    this.#binance = new BinancePublicAdapter({
      products: this.#config.binance.products,
      collectorRunId: this.#collectorRunId,
      depth: this.#config.book.depth,
      maxTrackedLevelsPerSide:
        this.#config.binance.maxTrackedLevelsPerSide,
      maxBufferedDepthEvents:
        this.#config.binance.maxBufferedDepthEvents,
      staleAfterMs: this.#config.binance.staleAfterMs
    });
    this.#bybit = new BybitPublicAdapter({
      products: this.#config.bybit.products,
      collectorRunId: this.#collectorRunId,
      depth: this.#config.book.depth,
      maxTrackedLevelsPerSide:
        this.#config.bybit.maxTrackedLevelsPerSide,
      maxRecentTradeIds: this.#config.bybit.maxRecentTradeIds,
      staleAfterMs: this.#config.bybit.staleAfterMs
    });
    this.#kraken = new KrakenPublicAdapter({
      products: this.#config.kraken.products,
      collectorRunId: this.#collectorRunId,
      depth: this.#config.kraken.depth,
      maxRecentTradeIds: this.#config.kraken.maxRecentTradeIds,
      staleAfterMs: this.#config.kraken.staleAfterMs
    });
    this.#waitPromise = new Promise((resolve) => {
      this.#resolveWait = resolve;
    });
  }

  get exitCode(): number {
    return this.#exitCode;
  }

  get collectorRunId(): string {
    return this.#collectorRunId;
  }

  async start(): Promise<void> {
    if (this.#started) {
      throw new Error("Public collector runner already started");
    }
    this.#started = true;
    this.#lastStorage = await measureStorage(this.#config.dataRoot);
    const storageReason = storageLimitReason(
      this.#lastStorage,
      this.#config.storage
    );
    if (storageReason !== null) {
      throw new Error(
        `Collector storage gate failed at startup: ${storageReason}`
      );
    }

    this.#healthTimer = setInterval(() => {
      const now = this.#now();
      this.#eventLoopLagMs = Math.max(
        0,
        now -
          this.#lastHealthScheduledAtMs -
          this.#config.runtime.healthIntervalMs
      );
      this.#lastHealthScheduledAtMs = now;
      void this.#healthTick();
    }, this.#config.runtime.healthIntervalMs);
    this.#staleTimer = setInterval(() => {
      void this.#staleTick();
    }, this.#config.runtime.staleCheckIntervalMs);
    this.#checkpointTimer = setInterval(() => {
      void this.#checkpointTick();
    }, this.#config.book.checkpointIntervalMs);

    await Promise.all(
      (["coinbase", "binance", "bybit", "kraken"] as const).map(
        async (venue) => this.#connect(venue)
      )
    );
    await this.#publishHealth();
    this.#log(
      `stable-corridor collector started run=${this.#collectorRunId}`
    );
  }

  wait(): Promise<void> {
    return this.#waitPromise;
  }

  async stop(reason = "operator_stop", exitCode = 0): Promise<void> {
    if (this.#stopping) {
      return this.#waitPromise;
    }
    this.#stopping = true;
    this.#stopReason = reason;
    this.#exitCode = exitCode;
    if (this.#healthTimer !== undefined) {
      clearInterval(this.#healthTimer);
      this.#healthTimer = undefined;
    }
    if (this.#staleTimer !== undefined) {
      clearInterval(this.#staleTimer);
      this.#staleTimer = undefined;
    }
    if (this.#checkpointTimer !== undefined) {
      clearInterval(this.#checkpointTimer);
      this.#checkpointTimer = undefined;
    }
    for (const timer of this.#reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.#reconnectTimers.clear();

    const now = this.#now();
    await Promise.all(
      [...this.#sessions.entries()].map(
        async ([venue, active]) => {
          await this.#append(
            active.endConnection(now, reason)
          ).catch(() => undefined);
          this.#sessions.delete(venue);
          active.session.stop(1000, "collector_stop");
        }
      )
    );
    this.#lastStorage = await measureStorage(
      this.#config.dataRoot
    ).catch(() => this.#lastStorage);
    await this.#publishHealth("stopping").catch(() => undefined);
    await this.#sink.close().catch(() => {
      this.#exitCode = 1;
    });
    this.#log(`stable-corridor collector stopped reason=${reason}`);
    this.#resolveWait?.();
    return this.#waitPromise;
  }

  async #connect(venue: VenueName): Promise<void> {
    if (
      this.#stopping ||
      this.#sessions.has(venue) ||
      this.#connectInProgress.has(venue)
    ) {
      return;
    }
    this.#connectInProgress.add(venue);
    try {
      switch (venue) {
        case "coinbase":
          await this.#connectCoinbase();
          break;
        case "binance":
          await this.#connectBinance();
          break;
        case "bybit":
          await this.#connectBybit();
          break;
        case "kraken":
          await this.#connectKraken();
          break;
      }
      this.#venueErrors.delete(venue);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.#venueErrors.set(venue, reason.slice(0, 128));
      this.#log(`${venue} public connection failed: ${reason}`);
      if (this.#sink.journalErrorCount > 0) {
        void this.stop("journal_failure", 1);
      } else {
        this.#scheduleReconnect(venue);
      }
    } finally {
      this.#connectInProgress.delete(venue);
    }
  }

  async #connectCoinbase(): Promise<void> {
    const connectionId = randomUUID();
    const started = this.#now();
    await this.#append(
      this.#coinbase.beginConnection(connectionId, started)
    );
    try {
      const metadata = await fetchCoinbasePublicProductsMetadata(
        this.#config.coinbase.products
      );
      await this.#append(
        metadata.map((product, index) =>
          normalizeCoinbaseProductMetadata(product, {
            receivedTimestampMs: this.#now(),
            ingestSequence: index,
            collectorRunId: this.#collectorRunId,
            connectionId
          })
        )
      );
      let session: CoinbasePublicWebSocketSession;
      session = new CoinbasePublicWebSocketSession({
        products: this.#config.coinbase.products,
        maxFrameBytes: this.#config.coinbase.maxFrameBytes,
        onFrame: async (frame, received) => {
          await this.#handleVenueEvents(
            "coinbase",
            this.#coinbase.ingest(frame, received)
          );
        },
        onClose: (code, reason) => {
          void this.#handleClose(
            "coinbase",
            session,
            code,
            reason
          );
        },
        onFatal: (error) => {
          this.#log(`coinbase public transport failure: ${error.message}`);
        }
      });
      this.#activateSession("coinbase", session, (time, reason) =>
        this.#coinbase.endConnection(time, reason)
      );
    } catch (error) {
      await this.#append(
        this.#coinbase.endConnection(
          this.#now(),
          "connection_setup_failed"
        )
      );
      throw error;
    }
  }

  async #connectBinance(): Promise<void> {
    const connectionId = randomUUID();
    await this.#append(
      this.#binance.beginConnection(connectionId, this.#now())
    );
    try {
      const exchangeInfo = await fetchBinancePublicExchangeInfo(
        this.#config.binance.products
      );
      await this.#append(
        this.#binance.ingestExchangeInfo(
          exchangeInfo,
          this.#now()
        )
      );
      let session: BinancePublicWebSocketSession;
      session = new BinancePublicWebSocketSession({
        products: this.#config.binance.products,
        maxFrameBytes: this.#config.binance.maxFrameBytes,
        onFrame: async (frame, received) => {
          await this.#handleVenueEvents(
            "binance",
            this.#binance.ingest(frame, received)
          );
        },
        onOpen: () => {
          void this.#bootstrapBinance(session).catch((error: unknown) => {
            const reason =
              error instanceof Error ? error.message : String(error);
            this.#log(`binance snapshot bootstrap failed: ${reason}`);
            session.stop(1011, "snapshot_bootstrap_failed");
          });
        },
        onClose: (code, reason) => {
          void this.#handleClose("binance", session, code, reason);
        },
        onFatal: (error) => {
          this.#log(`binance public transport failure: ${error.message}`);
        }
      });
      this.#activateSession("binance", session, (time, reason) =>
        this.#binance.endConnection(time, reason)
      );
    } catch (error) {
      await this.#append(
        this.#binance.endConnection(
          this.#now(),
          "connection_setup_failed"
        )
      );
      throw error;
    }
  }

  async #bootstrapBinance(
    session: BinancePublicWebSocketSession
  ): Promise<void> {
    for (const product of this.#config.binance.products) {
      let synchronized = false;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const snapshot = await fetchBinancePublicDepthSnapshot(product);
        await session.drain();
        await this.#handleVenueEvents(
          "binance",
          this.#binance.applyDepthSnapshot(
            product,
            snapshot,
            this.#now()
          )
        );
        const diagnostic = this.#binance
          .diagnostics()
          .products.find((candidate) => candidate.product === product);
        if (diagnostic?.state === "gapped") {
          throw new Error(`${product} gapped during snapshot bootstrap`);
        }
        if (diagnostic?.bookReady === true) {
          synchronized = true;
          break;
        }
      }
      if (!synchronized) {
        throw new Error(
          `${product} did not synchronize after five snapshots`
        );
      }
    }
  }

  async #connectBybit(): Promise<void> {
    const connectionId = randomUUID();
    await this.#append(
      this.#bybit.beginConnection(connectionId, this.#now())
    );
    try {
      const metadata = await fetchBybitPublicInstruments(
        this.#config.bybit.products
      );
      for (let index = 0; index < metadata.length; index += 1) {
        await this.#append(
          this.#bybit.ingestInstrument(
            this.#config.bybit.products[index]!,
            metadata[index],
            this.#now()
          )
        );
      }
      let session: BybitPublicWebSocketSession;
      session = new BybitPublicWebSocketSession({
        products: this.#config.bybit.products,
        maxFrameBytes: this.#config.bybit.maxFrameBytes,
        pingIntervalMs: this.#config.bybit.pingIntervalMs,
        onFrame: async (frame, received) => {
          await this.#handleVenueEvents(
            "bybit",
            this.#bybit.ingest(frame, received)
          );
        },
        onClose: (code, reason) => {
          void this.#handleClose("bybit", session, code, reason);
        },
        onFatal: (error) => {
          this.#log(`bybit public transport failure: ${error.message}`);
        }
      });
      this.#activateSession("bybit", session, (time, reason) =>
        this.#bybit.endConnection(time, reason)
      );
    } catch (error) {
      await this.#append(
        this.#bybit.endConnection(
          this.#now(),
          "connection_setup_failed"
        )
      );
      throw error;
    }
  }

  async #connectKraken(): Promise<void> {
    const connectionId = randomUUID();
    await this.#append(
      this.#kraken.beginConnection(connectionId, this.#now())
    );
    try {
      const metadata = await fetchKrakenPublicAssetPairs(
        this.#config.kraken.products
      );
      await this.#append(
        this.#kraken.ingestAssetPairs(metadata, this.#now())
      );
      let session: KrakenPublicWebSocketSession;
      session = new KrakenPublicWebSocketSession({
        products: this.#config.kraken.products,
        maxFrameBytes: this.#config.kraken.maxFrameBytes,
        onFrame: async (frame, received) => {
          await this.#handleVenueEvents(
            "kraken",
            this.#kraken.ingest(frame, received)
          );
        },
        onClose: (code, reason) => {
          void this.#handleClose("kraken", session, code, reason);
        },
        onFatal: (error) => {
          this.#log(`kraken public transport failure: ${error.message}`);
        }
      });
      this.#activateSession("kraken", session, (time, reason) =>
        this.#kraken.endConnection(time, reason)
      );
    } catch (error) {
      await this.#append(
        this.#kraken.endConnection(
          this.#now(),
          "connection_setup_failed"
        )
      );
      throw error;
    }
  }

  #activateSession(
    venue: VenueName,
    session: StoppableSession & { start(): void },
    endConnection: ActiveSession["endConnection"]
  ): void {
    this.#sessions.set(venue, { session, endConnection });
    try {
      session.start();
    } catch (error) {
      this.#sessions.delete(venue);
      throw error;
    }
  }

  async #handleVenueEvents(
    venue: VenueName,
    events: readonly NormalizedEvent[]
  ): Promise<void> {
    try {
      await this.#append(events);
    } catch (error) {
      void this.stop("journal_failure", 1);
      throw error;
    }
    if (
      events.some(
        (event) =>
          event.eventType === "feed_status" &&
          (event.payload.state === "gapped" ||
            event.payload.state === "stale")
      )
    ) {
      this.#sessions
        .get(venue)
        ?.session.stop(1011, "feed_recovery_required");
    }
  }

  async #handleClose(
    venue: VenueName,
    session: StoppableSession,
    code: number | undefined,
    reason: string
  ): Promise<void> {
    const active = this.#sessions.get(venue);
    if (active === undefined || active.session !== session) {
      return;
    }
    this.#sessions.delete(venue);
    const description =
      reason.length > 0
        ? `connection_closed:${code ?? 0}:${reason}`
        : `connection_closed:${code ?? 0}`;
    await this.#append(
      active.endConnection(this.#now(), description.slice(0, 512))
    ).catch(() => undefined);
    if (!this.#stopping) {
      this.#scheduleReconnect(venue);
    }
  }

  #scheduleReconnect(venue: VenueName): void {
    if (this.#stopping || this.#reconnectTimers.has(venue)) {
      return;
    }
    const timer = setTimeout(() => {
      this.#reconnectTimers.delete(venue);
      void this.#connect(venue);
    }, this.#config.runtime.reconnectDelayMs);
    this.#reconnectTimers.set(venue, timer);
  }

  async #staleTick(): Promise<void> {
    if (this.#stopping) {
      return;
    }
    const now = this.#now();
    await Promise.all([
      this.#handleVenueEvents(
        "coinbase",
        this.#coinbase.checkStaleness(now)
      ),
      this.#handleVenueEvents(
        "binance",
        this.#binance.checkStaleness(now)
      ),
      this.#handleVenueEvents("bybit", this.#bybit.checkStaleness(now)),
      this.#handleVenueEvents(
        "kraken",
        this.#kraken.checkStaleness(now)
      )
    ]).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      this.#log(`staleness check failed: ${reason}`);
      void this.stop("staleness_check_failure", 1);
    });
  }

  async #healthTick(): Promise<void> {
    if (this.#stopping || this.#healthRunning) {
      return;
    }
    this.#healthRunning = true;
    try {
      this.#lastStorage = await measureStorage(this.#config.dataRoot);
      const storageReason = storageLimitReason(
        this.#lastStorage,
        this.#config.storage
      );
      if (storageReason !== null) {
        await this.stop(storageReason, 1);
        return;
      }
      const result = await tryPublishCollectorHealthAtomic(
        this.#config.healthFile,
        this.#health()
      );
      if (!result.success) {
        this.#log(`health publication failed: ${result.error.message}`);
        await this.stop("health_publication_failure", 1);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.#log(`health/storage measurement failed: ${reason}`);
      await this.stop("health_measurement_failure", 1);
    } finally {
      this.#healthRunning = false;
    }
  }

  async #checkpointTick(): Promise<void> {
    if (this.#stopping) {
      return;
    }
    const now = this.#now();
    await Promise.all([
      this.#handleVenueEvents(
        "coinbase",
        this.#coinbase.checkpoint(now)
      ),
      this.#handleVenueEvents(
        "binance",
        this.#binance.checkpoint(now)
      ),
      this.#handleVenueEvents("bybit", this.#bybit.checkpoint(now)),
      this.#handleVenueEvents("kraken", this.#kraken.checkpoint(now))
    ]).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      this.#log(`periodic checkpoint failed: ${reason}`);
      void this.stop("checkpoint_failure", 1);
    });
  }

  async #publishHealth(
    statusOverride?: CollectorHealth["status"]
  ): Promise<void> {
    await publishCollectorHealthAtomic(
      this.#config.healthFile,
      this.#health(statusOverride)
    );
  }

  #health(
    statusOverride?: CollectorHealth["status"]
  ): CollectorHealth {
    const now = this.#now();
    const feeds = this.#sink.feedHealth(this.#feedDiagnostics(), now);
    const reasonCodes = new Set<string>();
    for (const feed of feeds) {
      if (feed.connectionState !== "healthy") {
        reasonCodes.add(
          `feed_${feed.venue}_${feed.connectionState}`.slice(0, 128)
        );
      }
    }
    for (const venue of this.#venueErrors.keys()) {
      reasonCodes.add(`connection_${venue}`);
    }
    if (this.#sink.journalErrorCount > 0) {
      reasonCodes.add("journal_error");
    }
    if (this.#stopReason !== undefined) {
      reasonCodes.add(this.#stopReason.slice(0, 128));
    }
    const status =
      statusOverride ??
      (this.#sink.journalErrorCount > 0
        ? "unhealthy"
        : reasonCodes.size > 0
          ? "degraded"
          : "healthy");
    return {
      schemaVersion: 1,
      processName: "stable-corridor-collector",
      status,
      reasonCodes: [...reasonCodes].sort(),
      commitSha: this.#commitSha,
      configHash: this.#configHash,
      startedAtMs: this.#startedAtMs,
      publishedAtMs: now,
      eventLoopLagMs: this.#eventLoopLagMs,
      memoryRssBytes: process.memoryUsage().rss,
      dataRootBytes: this.#lastStorage.dataRootBytes,
      diskFreeBytes: this.#lastStorage.diskFreeBytes,
      journalLastWriteAtMs: this.#sink.journalLastWriteAtMs,
      journalErrorCount: this.#sink.journalErrorCount,
      feeds: [...feeds]
    };
  }

  #feedDiagnostics(): readonly FeedDiagnostic[] {
    const output: FeedDiagnostic[] = [];
    const coinbase = this.#coinbase.diagnostics();
    for (const product of coinbase.products) {
      output.push({
        venue: "coinbase",
        product: product.product,
        connectionState: product.state,
        venueSequence: product.lastGoodVenueSequence,
        gapCount: product.gapCount,
        reconnectCount: coinbase.reconnectCount,
        crossedBookCount: product.crossedBookCount,
        eligibleForResearch: product.state === "healthy"
      });
    }
    const binance = this.#binance.diagnostics();
    for (const product of binance.products) {
      output.push({
        venue: "binance",
        product: binanceCanonicalProduct(product.product),
        connectionState: product.state,
        venueSequence: product.lastGoodVenueSequence,
        gapCount: product.gapCount,
        reconnectCount: binance.reconnectCount,
        crossedBookCount: product.crossedBookCount,
        eligibleForResearch: product.state === "healthy"
      });
    }
    const bybit = this.#bybit.diagnostics();
    for (const product of bybit.products) {
      output.push({
        venue: "bybit",
        product: bybitCanonicalProduct(product.product),
        connectionState: product.state,
        venueSequence: product.lastGoodVenueSequence,
        gapCount: product.gapCount,
        reconnectCount: bybit.reconnectCount,
        crossedBookCount: product.crossedBookCount,
        eligibleForResearch: product.state === "healthy"
      });
    }
    const kraken = this.#kraken.diagnostics();
    for (const product of kraken.products) {
      output.push({
        venue: "kraken",
        product: krakenCanonicalProduct(product.product),
        connectionState: product.state,
        venueSequence: product.lastGoodVenueSequence,
        gapCount: product.gapCount,
        reconnectCount: kraken.reconnectCount,
        crossedBookCount: product.crossedBookCount,
        eligibleForResearch: product.state === "healthy"
      });
    }
    return output;
  }

  async #append(events: readonly NormalizedEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }
    await this.#sink.append(events);
  }
}
