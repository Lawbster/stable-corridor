import type { ReplayPosition } from "../replay/order.js";
import type { NormalizedEvent } from "../collector/schema/events.js";
import {
  CoinbaseExecutableBook,
  compareCoinbaseJupiterQuote,
  modeledCexDexEdgeBps,
  type CexDexEdgeSample
} from "./cex-dex-model.js";

export type {
  CexDexDirection,
  CexDexEdgeSample
} from "./cex-dex-model.js";

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
    readonly eligibleBaselineComparisons: number;
    readonly eligibleAnomalyFollowUpComparisons: number;
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
  readonly triggeredRequotes: {
    readonly caveat:
      "public_requotes_do_not_prove_transaction_construction_or_landing";
    readonly scheduledProbes: number;
    readonly completedProbes: number;
    readonly firstFollowUpsEvaluated: number;
    readonly confirmedAtFirstFollowUp: number;
    readonly confirmedThroughAllFollowUps: number;
    readonly missingTriggerQuote: number;
    readonly probes: readonly TriggeredProbeSummary[];
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

interface PersistenceStart {
  readonly receivedTimestampMs: number;
  readonly modeledNetEdgeBps: number;
}

type CexDexProbeEvent = Extract<
  NormalizedEvent,
  { readonly eventType: "cex_dex_probe" }
>;

interface TriggeredFollowUpSummary {
  readonly followUpIndex: number;
  readonly receivedTimestampMs: number;
  readonly intervalFromTriggerMs: number;
  readonly modeledNetEdgeBps: number;
  readonly router: string;
}

interface TriggeredProbeSummary {
  readonly probeId: string;
  readonly direction: CexDexProbeEvent["payload"]["direction"];
  readonly inputAmount: string;
  readonly triggerReceivedTimestampMs: number;
  readonly triggerModeledNetEdgeBps: number;
  readonly decisionThresholdBps: number;
  readonly expectedFollowUps: number;
  readonly observedEligibleFollowUps: number;
  readonly duplicateFollowUpIndexes: number;
  readonly complete: boolean;
  readonly firstFollowUpConfirmed: boolean;
  readonly confirmedThroughAllFollowUps: boolean;
  readonly followUps: readonly TriggeredFollowUpSummary[];
}

function percentile(
  sortedValues: readonly number[],
  fraction: number
): number | null {
  if (sortedValues.length === 0) {
    return null;
  }
  return sortedValues[
    Math.floor((sortedValues.length - 1) * fraction)
  ]!;
}

function distribution(values: readonly number[]): Distribution {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    p05: percentile(sorted, 0.05),
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    minimum: sorted[0] ?? null,
    maximum: sorted.at(-1) ?? null
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

function summarizeTriggeredRequotes(
  probeEvents: readonly CexDexProbeEvent[],
  baselineByRequestId: ReadonlyMap<string, CexDexEdgeSample>,
  followUpsByTrigger: ReadonlyMap<string, readonly CexDexEdgeSample[]>
): CexDexScanReport["triggeredRequotes"] {
  let missingTriggerQuote = 0;
  const probes = probeEvents.map((event): TriggeredProbeSummary => {
    if (!baselineByRequestId.has(event.payload.triggerRequestId)) {
      missingTriggerQuote += 1;
    }
    const observed = [
      ...(followUpsByTrigger.get(event.payload.triggerRequestId) ?? [])
    ].sort(
      (left, right) =>
        (left.probe?.kind === "anomaly_follow_up"
          ? left.probe.followUpIndex
          : 0) -
          (right.probe?.kind === "anomaly_follow_up"
            ? right.probe.followUpIndex
            : 0) ||
        left.receivedTimestampMs - right.receivedTimestampMs
    );
    const byIndex = new Map<number, CexDexEdgeSample>();
    let duplicateFollowUpIndexes = 0;
    for (const sample of observed) {
      if (sample.probe?.kind !== "anomaly_follow_up") {
        continue;
      }
      if (byIndex.has(sample.probe.followUpIndex)) {
        duplicateFollowUpIndexes += 1;
      } else {
        byIndex.set(sample.probe.followUpIndex, sample);
      }
    }
    const threshold = Number(event.payload.model.decisionThresholdBps);
    const followUps = [...byIndex.entries()]
      .sort(([left], [right]) => left - right)
      .map(([followUpIndex, sample]) => ({
        followUpIndex,
        receivedTimestampMs: sample.receivedTimestampMs,
        intervalFromTriggerMs:
          sample.receivedTimestampMs -
          event.payload.triggerReceivedTimestampMs,
        modeledNetEdgeBps: sample.modeledNetEdgeBps,
        router: sample.router
      }));
    const complete = Array.from(
      { length: event.payload.followUpCount },
      (_, index) => index + 1
    ).every((index) => byIndex.has(index));
    const first = byIndex.get(1);
    return {
      probeId: event.payload.probeId,
      direction: event.payload.direction,
      inputAmount: event.payload.inputAmount,
      triggerReceivedTimestampMs:
        event.payload.triggerReceivedTimestampMs,
      triggerModeledNetEdgeBps: Number(
        event.payload.modeledNetEdgeBps
      ),
      decisionThresholdBps: threshold,
      expectedFollowUps: event.payload.followUpCount,
      observedEligibleFollowUps: byIndex.size,
      duplicateFollowUpIndexes,
      complete,
      firstFollowUpConfirmed:
        first !== undefined && first.modeledNetEdgeBps >= threshold,
      confirmedThroughAllFollowUps:
        complete &&
        [...byIndex.values()].every(
          (sample) => sample.modeledNetEdgeBps >= threshold
        ),
      followUps
    };
  });
  return {
    caveat:
      "public_requotes_do_not_prove_transaction_construction_or_landing",
    scheduledProbes: probes.length,
    completedProbes: probes.filter((probe) => probe.complete).length,
    firstFollowUpsEvaluated: probes.filter(
      (probe) => probe.observedEligibleFollowUps > 0
    ).length,
    confirmedAtFirstFollowUp: probes.filter(
      (probe) => probe.firstFollowUpConfirmed
    ).length,
    confirmedThroughAllFollowUps: probes.filter(
      (probe) => probe.confirmedThroughAllFollowUps
    ).length,
    missingTriggerQuote,
    probes
  };
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

  const book = new CoinbaseExecutableBook();
  let coinbaseEligible = false;
  const samples: CexDexEdgeSample[] = [];
  const followUpSamples: CexDexEdgeSample[] = [];
  const baselineByRequestId = new Map<string, CexDexEdgeSample>();
  const followUpsByTrigger = new Map<string, CexDexEdgeSample[]>();
  const probeEvents: CexDexProbeEvent[] = [];
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
      event.venue === "jupiter" &&
      event.product === "EURC-USDC" &&
      event.eventType === "cex_dex_probe"
    ) {
      probeEvents.push(event);
      previousByKey.delete(
        `${event.payload.direction}|${event.payload.inputAmount}`
      );
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

    const sample = compareCoinbaseJupiterQuote(event, book, {
      coinbaseFeeBps,
      modeledNetworkFeeUsdc,
      executionBufferBps
    });
    if (sample === null) {
      insufficientCoinbaseDepth += 1;
      continue;
    }
    if (sample.probe?.kind === "anomaly_follow_up") {
      followUpSamples.push(sample);
      const entries =
        followUpsByTrigger.get(sample.probe.triggerRequestId) ?? [];
      entries.push(sample);
      followUpsByTrigger.set(sample.probe.triggerRequestId, entries);
      continue;
    }
    samples.push(sample);
    baselineByRequestId.set(sample.quoteRequestId, sample);
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
  const triggeredRequotes = summarizeTriggeredRequotes(
    probeEvents,
    baselineByRequestId,
    followUpsByTrigger
  );
  const classification:
    CexDexScanReport["economicBearing"]["classification"] =
    !sufficientlyObserved
      ? "insufficient_observation"
      : qualifying === 0
        ? "no_modeled_3bp_opportunity"
        : triggeredRequotes.scheduledProbes > 0
          ? triggeredRequotes.confirmedAtFirstFollowUp === 0
            ? "sampled_3bp_not_persistent"
            : "sampled_3bp_requires_execution_model"
          : confirmedAtNextQuote === 0
          ? "sampled_3bp_not_persistent"
          : "sampled_3bp_requires_execution_model";

  const feeSensitivity = Object.fromEntries(
    [0, 0.1, 0.45].map((feeBps) => {
      const edges = samples.map((sample) =>
        modeledCexDexEdgeBps(
          sample,
          {
            coinbaseFeeBps: feeBps,
            modeledNetworkFeeUsdc,
            executionBufferBps
          }
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
      eligibleComparisons: samples.length + followUpSamples.length,
      eligibleBaselineComparisons: samples.length,
      eligibleAnomalyFollowUpComparisons: followUpSamples.length,
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
    triggeredRequotes,
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
