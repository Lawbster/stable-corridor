import type { NormalizedEvent } from "../collector/schema/events.js";
import type { ReplayPosition } from "../replay/order.js";

type BookCheckpointEvent = Extract<
  NormalizedEvent,
  { readonly eventType: "book_checkpoint" }
>;
type BookDeltaEvent = Extract<
  NormalizedEvent,
  { readonly eventType: "book_delta" }
>;
type DexQuoteEvent = Extract<
  NormalizedEvent,
  { readonly eventType: "dex_quote" }
>;

export type CexDexDirection =
  | "buy_eurc_jupiter_sell_coinbase"
  | "buy_eurc_coinbase_sell_jupiter";

export interface CexDexScanOptions {
  readonly collectorRunId: string;
  readonly coinbaseFeeBps?: number;
  readonly modeledNetworkFeeUsdc?: number;
  readonly executionBufferBps?: number;
  readonly decisionThresholdBps?: number;
  readonly persistenceHorizonMs?: number;
  readonly minimumSamplesPerRouteSize?: number;
  readonly minimumObservationHours?: number;
}

interface Distribution {
  readonly p05: number | null;
  readonly p50: number | null;
  readonly p95: number | null;
  readonly p99: number | null;
  readonly minimum: number | null;
  readonly maximum: number | null;
}

interface ThresholdCount {
  readonly count: number;
  readonly share: number;
}

interface RouteSizeSummary {
  readonly samples: number;
  readonly firstReceivedTimestampMs: number | null;
  readonly lastReceivedTimestampMs: number | null;
  readonly quoteLatencyMs: Distribution;
  readonly grossEdgeBps: Distribution;
  readonly modeledNetEdgeBps: Distribution;
  readonly grossThresholds: Readonly<Record<string, ThresholdCount>>;
  readonly modeledNetThresholds: Readonly<Record<string, ThresholdCount>>;
  readonly routers: Readonly<Record<string, number>>;
}

export interface CexDexScanReport {
  readonly schemaVersion: 1;
  readonly reportType: "coinbase_jupiter_public_quote_screen";
  readonly collectorRunId: string;
  readonly target: "EURC-USDC";
  readonly timingSemantics:
    "quote_decision_at_local_receive_time_no_lookahead";
  readonly model: {
    readonly coinbaseFeeBps: number;
    readonly modeledNetworkFeeUsdc: number;
    readonly executionBufferBps: number;
    readonly decisionThresholdBps: number;
    readonly persistenceHorizonMs: number;
    readonly inventoryAssumption:
      "prefunded_inventory_no_transfer_in_critical_path";
  };
  readonly observations: {
    readonly totalJupiterQuotes: number;
    readonly eligibleComparisons: number;
    readonly coinbaseBookUnavailable: number;
    readonly coinbaseFeedIneligible: number;
    readonly insufficientCoinbaseDepth: number;
    readonly crossedCoinbaseBook: number;
    readonly firstReceivedTimestampMs: number | null;
    readonly lastReceivedTimestampMs: number | null;
    readonly elapsedHours: number | null;
  };
  readonly byRouteSize: Readonly<Record<string, RouteSizeSummary>>;
  readonly largestModeledEdges: readonly CexDexEdgeSample[];
  readonly feeSensitivity: Readonly<
    Record<
      string,
      {
        readonly atLeastDecisionThreshold: ThresholdCount;
        readonly modeledNetEdgeBps: Distribution;
      }
    >
  >;
  readonly sampledPersistence: {
    readonly caveat:
      "next_quote_confirmation_does_not_prove_continuous_opportunity";
    readonly evaluatedStarts: number;
    readonly confirmedAtNextQuote: number;
    readonly confirmationShare: number;
    readonly unresolvedStarts: number;
    readonly confirmationIntervalMs: Distribution;
  };
  readonly economicBearing: {
    readonly classification:
      | "insufficient_observation"
      | "no_modeled_3bp_opportunity"
      | "sampled_3bp_not_persistent"
      | "sampled_3bp_requires_execution_model";
    readonly isProfitabilityResult: false;
    readonly blockers: readonly string[];
  };
}

export interface CexDexEdgeSample {
  readonly key: string;
  readonly direction: CexDexDirection;
  readonly inputAmount: string;
  readonly receivedTimestampMs: number;
  readonly quoteLatencyMs: number;
  readonly router: string;
  readonly capitalUsdc: number;
  readonly coinbaseFeeNotionalUsdc: number;
  readonly zeroFeePnlUsdc: number;
  readonly grossEdgeBps: number;
  readonly modeledNetEdgeBps: number;
}

interface PersistenceStart {
  readonly receivedTimestampMs: number;
  readonly modeledNetEdgeBps: number;
}

class CoinbaseReplayBook {
  readonly #bids = new Map<number, number>();
  readonly #asks = new Map<number, number>();
  #ready = false;

  get ready(): boolean {
    return this.#ready;
  }

  reset(event: BookCheckpointEvent): void {
    this.#bids.clear();
    this.#asks.clear();
    for (const level of event.payload.bids) {
      this.#set(this.#bids, level.price, level.quantity);
    }
    for (const level of event.payload.asks) {
      this.#set(this.#asks, level.price, level.quantity);
    }
    this.#ready = true;
  }

  apply(event: BookDeltaEvent): void {
    if (
      !this.#ready ||
      event.payload.updateSemantics !== "absolute"
    ) {
      this.#ready = false;
      return;
    }
    for (const change of event.payload.changes) {
      this.#set(
        change.side === "bid" ? this.#bids : this.#asks,
        change.price,
        change.quantity
      );
    }
  }

  crossed(): boolean {
    const bid = this.#ordered(this.#bids, true)[0]?.[0];
    const ask = this.#ordered(this.#asks, false)[0]?.[0];
    return bid !== undefined && ask !== undefined && bid >= ask;
  }

  buyCost(quantity: number): number | null {
    return this.#fill(this.#ordered(this.#asks, false), quantity);
  }

  sellProceeds(quantity: number): number | null {
    return this.#fill(this.#ordered(this.#bids, true), quantity);
  }

  #set(side: Map<number, number>, price: string, quantity: string): void {
    const priceNumber = Number(price);
    const quantityNumber = Number(quantity);
    if (
      !Number.isFinite(priceNumber) ||
      priceNumber <= 0 ||
      !Number.isFinite(quantityNumber) ||
      quantityNumber < 0
    ) {
      this.#ready = false;
      return;
    }
    if (quantityNumber === 0) {
      side.delete(priceNumber);
    } else {
      side.set(priceNumber, quantityNumber);
    }
  }

  #ordered(
    side: ReadonlyMap<number, number>,
    descending: boolean
  ): readonly (readonly [number, number])[] {
    return [...side.entries()].sort(([left], [right]) =>
      descending ? right - left : left - right
    );
  }

  #fill(
    levels: readonly (readonly [number, number])[],
    requestedQuantity: number
  ): number | null {
    let remaining = requestedQuantity;
    let quoteAmount = 0;
    for (const [price, available] of levels) {
      const filled = Math.min(remaining, available);
      quoteAmount += filled * price;
      remaining -= filled;
      if (remaining <= 1e-9) {
        return quoteAmount;
      }
    }
    return null;
  }
}

function percentile(
  values: readonly number[],
  fraction: number
): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.floor((sorted.length - 1) * fraction)
  ]!;
}

function distribution(values: readonly number[]): Distribution {
  return {
    p05: percentile(values, 0.05),
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
    minimum: values.length === 0 ? null : Math.min(...values),
    maximum: values.length === 0 ? null : Math.max(...values)
  };
}

function thresholdCount(
  values: readonly number[],
  threshold: number
): ThresholdCount {
  const count = values.filter((value) => value >= threshold).length;
  return {
    count,
    share: values.length === 0 ? 0 : count / values.length
  };
}

function thresholdTable(
  values: readonly number[]
): Readonly<Record<string, ThresholdCount>> {
  return Object.fromEntries(
    [0, 1, 2, 3, 5, 10].map((threshold) => [
      `${threshold}bp`,
      thresholdCount(values, threshold)
    ])
  );
}

function modeledEdge(
  sample: Pick<
    CexDexEdgeSample,
    "capitalUsdc" | "coinbaseFeeNotionalUsdc" | "zeroFeePnlUsdc"
  >,
  coinbaseFeeBps: number,
  networkFeeUsdc: number,
  executionBufferBps: number
): number {
  const fee =
    sample.coinbaseFeeNotionalUsdc * (coinbaseFeeBps / 10_000);
  return (
    ((sample.zeroFeePnlUsdc - fee - networkFeeUsdc) /
      sample.capitalUsdc) *
      10_000 -
    executionBufferBps
  );
}

function routeSizeSummary(
  samples: readonly CexDexEdgeSample[]
): RouteSizeSummary {
  const gross = samples.map((sample) => sample.grossEdgeBps);
  const net = samples.map((sample) => sample.modeledNetEdgeBps);
  return {
    samples: samples.length,
    firstReceivedTimestampMs:
      samples[0]?.receivedTimestampMs ?? null,
    lastReceivedTimestampMs:
      samples.at(-1)?.receivedTimestampMs ?? null,
    quoteLatencyMs: distribution(
      samples.map((sample) => sample.quoteLatencyMs)
    ),
    grossEdgeBps: distribution(gross),
    modeledNetEdgeBps: distribution(net),
    grossThresholds: thresholdTable(gross),
    modeledNetThresholds: thresholdTable(net),
    routers: Object.fromEntries(
      [...new Set(samples.map((sample) => sample.router))]
        .sort()
        .map((router) => [
          router,
          samples.filter((sample) => sample.router === router).length
        ])
    )
  };
}

function validateNonNegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

export async function scanCoinbaseJupiterQuotes(
  positions: AsyncIterable<ReplayPosition>,
  options: CexDexScanOptions
): Promise<CexDexScanReport> {
  const coinbaseFeeBps = options.coinbaseFeeBps ?? 0.1;
  const modeledNetworkFeeUsdc =
    options.modeledNetworkFeeUsdc ?? 0.01;
  const executionBufferBps = options.executionBufferBps ?? 2;
  const decisionThresholdBps = options.decisionThresholdBps ?? 3;
  const persistenceHorizonMs = options.persistenceHorizonMs ?? 2_000;
  const minimumSamplesPerRouteSize =
    options.minimumSamplesPerRouteSize ?? 100;
  const minimumObservationHours = options.minimumObservationHours ?? 24;
  for (const [label, value] of [
    ["Coinbase fee bps", coinbaseFeeBps],
    ["modeled network fee", modeledNetworkFeeUsdc],
    ["execution buffer bps", executionBufferBps],
    ["decision threshold bps", decisionThresholdBps]
  ] as const) {
    validateNonNegativeFinite(value, label);
  }

  const book = new CoinbaseReplayBook();
  let coinbaseEligible = false;
  const samples: CexDexEdgeSample[] = [];
  const previousByKey = new Map<string, PersistenceStart>();
  const lastSampleAtByKey = new Map<string, number>();
  const confirmationIntervals: number[] = [];
  let totalJupiterQuotes = 0;
  let coinbaseBookUnavailable = 0;
  let coinbaseFeedIneligible = 0;
  let insufficientCoinbaseDepth = 0;
  let crossedCoinbaseBook = 0;
  let evaluatedStarts = 0;
  let confirmedAtNextQuote = 0;

  for await (const { event } of positions) {
    if (event.collectorRunId !== options.collectorRunId) {
      continue;
    }
    if (
      event.venue === "coinbase" &&
      event.product === "EURC-USDC"
    ) {
      if (event.eventType === "feed_status") {
        coinbaseEligible =
          event.payload.state === "healthy" &&
          event.payload.eligibleForResearch;
      } else if (event.eventType === "book_checkpoint") {
        book.reset(event);
      } else if (event.eventType === "book_delta") {
        book.apply(event);
      }
      continue;
    }
    if (
      event.venue !== "jupiter" ||
      event.product !== "EURC-USDC" ||
      event.eventType !== "dex_quote"
    ) {
      continue;
    }
    totalJupiterQuotes += 1;
    if (!book.ready) {
      coinbaseBookUnavailable += 1;
      continue;
    }
    if (!coinbaseEligible) {
      coinbaseFeedIneligible += 1;
      continue;
    }
    if (book.crossed()) {
      crossedCoinbaseBook += 1;
      continue;
    }

    const sample = compareQuote(event, book, {
      coinbaseFeeBps,
      modeledNetworkFeeUsdc,
      executionBufferBps
    });
    if (sample === null) {
      insufficientCoinbaseDepth += 1;
      continue;
    }
    samples.push(sample);
    lastSampleAtByKey.set(sample.key, sample.receivedTimestampMs);

    const previous = previousByKey.get(sample.key);
    if (
      previous !== undefined &&
      sample.receivedTimestampMs - previous.receivedTimestampMs >=
        persistenceHorizonMs
    ) {
      evaluatedStarts += 1;
      if (sample.modeledNetEdgeBps >= decisionThresholdBps) {
        confirmedAtNextQuote += 1;
        confirmationIntervals.push(
          sample.receivedTimestampMs - previous.receivedTimestampMs
        );
      }
    }
    if (sample.modeledNetEdgeBps >= decisionThresholdBps) {
      previousByKey.set(sample.key, {
        receivedTimestampMs: sample.receivedTimestampMs,
        modeledNetEdgeBps: sample.modeledNetEdgeBps
      });
    } else {
      previousByKey.delete(sample.key);
    }
  }

  const grouped = new Map<string, CexDexEdgeSample[]>();
  for (const sample of samples) {
    const entries = grouped.get(sample.key) ?? [];
    entries.push(sample);
    grouped.set(sample.key, entries);
  }
  const byRouteSize = Object.fromEntries(
    [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entries]) => [key, routeSizeSummary(entries)])
  );
  const largestModeledEdges = [...samples]
    .sort(
      (left, right) =>
        right.modeledNetEdgeBps - left.modeledNetEdgeBps ||
        left.receivedTimestampMs - right.receivedTimestampMs ||
        left.key.localeCompare(right.key)
    )
    .slice(0, 20);
  const first = samples[0]?.receivedTimestampMs;
  const last = samples.at(-1)?.receivedTimestampMs;
  const elapsedHours =
    first === undefined || last === undefined
      ? null
      : (last - first) / 3_600_000;
  const sufficientlyObserved =
    grouped.size === 4 &&
    [...grouped.values()].every(
      (entries) => entries.length >= minimumSamplesPerRouteSize
    ) &&
    (elapsedHours ?? 0) >= minimumObservationHours;
  const qualifying = samples.filter(
    (sample) => sample.modeledNetEdgeBps >= decisionThresholdBps
  ).length;
  const classification:
    CexDexScanReport["economicBearing"]["classification"] =
    !sufficientlyObserved
      ? "insufficient_observation"
      : qualifying === 0
        ? "no_modeled_3bp_opportunity"
        : confirmedAtNextQuote === 0
          ? "sampled_3bp_not_persistent"
          : "sampled_3bp_requires_execution_model";

  const feeSensitivity = Object.fromEntries(
    [0, 0.1, 0.45].map((feeBps) => {
      const edges = samples.map((sample) =>
        modeledEdge(
          sample,
          feeBps,
          modeledNetworkFeeUsdc,
          executionBufferBps
        )
      );
      return [
        `${feeBps}bp`,
        {
          atLeastDecisionThreshold: thresholdCount(
            edges,
            decisionThresholdBps
          ),
          modeledNetEdgeBps: distribution(edges)
        }
      ];
    })
  );

  return {
    schemaVersion: 1,
    reportType: "coinbase_jupiter_public_quote_screen",
    collectorRunId: options.collectorRunId,
    target: "EURC-USDC",
    timingSemantics:
      "quote_decision_at_local_receive_time_no_lookahead",
    model: {
      coinbaseFeeBps,
      modeledNetworkFeeUsdc,
      executionBufferBps,
      decisionThresholdBps,
      persistenceHorizonMs,
      inventoryAssumption:
        "prefunded_inventory_no_transfer_in_critical_path"
    },
    observations: {
      totalJupiterQuotes,
      eligibleComparisons: samples.length,
      coinbaseBookUnavailable,
      coinbaseFeedIneligible,
      insufficientCoinbaseDepth,
      crossedCoinbaseBook,
      firstReceivedTimestampMs: first ?? null,
      lastReceivedTimestampMs: last ?? null,
      elapsedHours
    },
    byRouteSize,
    largestModeledEdges,
    feeSensitivity,
    sampledPersistence: {
      caveat:
        "next_quote_confirmation_does_not_prove_continuous_opportunity",
      evaluatedStarts,
      confirmedAtNextQuote,
      confirmationShare:
        evaluatedStarts === 0 ? 0 : confirmedAtNextQuote / evaluatedStarts,
      unresolvedStarts: [...previousByKey.entries()].filter(
        ([key, start]) =>
          (lastSampleAtByKey.get(key) ?? start.receivedTimestampMs) -
            start.receivedTimestampMs <
          persistenceHorizonMs
      ).length,
      confirmationIntervalMs: distribution(confirmationIntervals)
    },
    economicBearing: {
      classification,
      isProfitabilityResult: false,
      blockers: [
        "Public Jupiter quotes are indicative until execution and account-specific behavior are tested.",
        "Next-quote persistence is sampled and does not prove the edge remained continuously executable.",
        "The model excludes adverse selection, failed transactions, priority-fee spikes, and inventory carry.",
        "Coinbase depth is known only to the collector's configured level limit."
      ]
    }
  };
}

function compareQuote(
  event: DexQuoteEvent,
  book: CoinbaseReplayBook,
  model: {
    readonly coinbaseFeeBps: number;
    readonly modeledNetworkFeeUsdc: number;
    readonly executionBufferBps: number;
  }
): CexDexEdgeSample | null {
  const inputAmount = Number(event.payload.inputAmount);
  const outputAmount = Number(event.payload.outputAmount);
  if (
    !Number.isFinite(inputAmount) ||
    inputAmount <= 0 ||
    !Number.isFinite(outputAmount) ||
    outputAmount <= 0
  ) {
    return null;
  }
  if (
    event.payload.inputAsset === "USDC" &&
    event.payload.outputAsset === "EURC"
  ) {
    const proceeds = book.sellProceeds(outputAmount);
    if (proceeds === null) {
      return null;
    }
    const zeroFeePnlUsdc = proceeds - inputAmount;
    const base = {
      key: `buy_eurc_jupiter_sell_coinbase|${event.payload.inputAmount}`,
      direction:
        "buy_eurc_jupiter_sell_coinbase" as const,
      inputAmount: event.payload.inputAmount,
      receivedTimestampMs: event.receivedTimestampMs,
      quoteLatencyMs: event.payload.quoteLatencyMs,
      router: event.payload.router,
      capitalUsdc: inputAmount,
      coinbaseFeeNotionalUsdc: proceeds,
      zeroFeePnlUsdc,
      grossEdgeBps: (zeroFeePnlUsdc / inputAmount) * 10_000
    };
    return {
      ...base,
      modeledNetEdgeBps: modeledEdge(
        base,
        model.coinbaseFeeBps,
        model.modeledNetworkFeeUsdc,
        model.executionBufferBps
      )
    };
  }
  if (
    event.payload.inputAsset === "EURC" &&
    event.payload.outputAsset === "USDC"
  ) {
    const cost = book.buyCost(inputAmount);
    if (cost === null) {
      return null;
    }
    const zeroFeePnlUsdc = outputAmount - cost;
    const base = {
      key: `buy_eurc_coinbase_sell_jupiter|${event.payload.inputAmount}`,
      direction:
        "buy_eurc_coinbase_sell_jupiter" as const,
      inputAmount: event.payload.inputAmount,
      receivedTimestampMs: event.receivedTimestampMs,
      quoteLatencyMs: event.payload.quoteLatencyMs,
      router: event.payload.router,
      capitalUsdc: cost,
      coinbaseFeeNotionalUsdc: cost,
      zeroFeePnlUsdc,
      grossEdgeBps: (zeroFeePnlUsdc / cost) * 10_000
    };
    return {
      ...base,
      modeledNetEdgeBps: modeledEdge(
        base,
        model.coinbaseFeeBps,
        model.modeledNetworkFeeUsdc,
        model.executionBufferBps
      )
    };
  }
  return null;
}
