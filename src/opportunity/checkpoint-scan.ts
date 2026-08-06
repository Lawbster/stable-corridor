import type {
  NormalizedEvent
} from "../collector/schema/events.js";
import type { ReplayPosition } from "../replay/order.js";

type BookCheckpointEvent = Extract<
  NormalizedEvent,
  { readonly eventType: "book_checkpoint" }
>;

export interface CorridorCheckpointScanOptions {
  readonly collectorRunId: string;
  readonly freshnessMs?: number;
  readonly maxReferenceDispersionBps?: number;
  readonly targetSampleIntervalMs?: number;
}

interface CheckpointSample {
  readonly receivedTimestampMs: number;
  readonly utcDate: string;
  readonly spreadBps: number;
  readonly dislocationBps: number;
  readonly absoluteDislocationBps: number;
  readonly referenceDispersionBps: number;
  readonly selectedMakerGrossEdgeBps: number;
  readonly selectedTopQuantity: number;
}

interface Distribution {
  readonly p05: number | null;
  readonly p25: number | null;
  readonly p50: number | null;
  readonly p75: number | null;
  readonly p95: number | null;
  readonly p99: number | null;
  readonly maximum: number | null;
}

interface ThresholdObservation {
  readonly count: number;
  readonly share: number;
}

interface EpisodeSummary {
  readonly count: number;
  readonly maximumMinutes: number;
}

interface DateSummary {
  readonly samples: number;
  readonly medianAbsoluteDislocationBps: number | null;
  readonly p95AbsoluteDislocationBps: number | null;
  readonly maximumAbsoluteDislocationBps: number | null;
  readonly atLeast2Bps: number;
  readonly atLeast3Bps: number;
}

export interface CorridorCheckpointScanReport {
  readonly schemaVersion: 1;
  readonly reportType: "stable_corridor_checkpoint_edge_screen";
  readonly collectorRunId: string;
  readonly target: "coinbase|EURC-USDC";
  readonly referenceRoutes: readonly [
    "binance|EUR-USDC",
    "bybit|USDC-EUR inverted",
    "kraken|USDC-EUR inverted"
  ];
  readonly freshnessMs: number;
  readonly maxReferenceDispersionBps: number;
  readonly targetSampleIntervalMs: number;
  readonly observations: {
    readonly totalCheckpointEvents: number;
    readonly eligibleTargetSamples: number;
    readonly highConfidenceSamples: number;
    readonly firstReceivedTimestampMs: number | null;
    readonly lastReceivedTimestampMs: number | null;
    readonly elapsedHours: number | null;
    readonly observedUtcDates: number;
    readonly summedDailyObservationHours: number | null;
    readonly targetCheapSamples: number;
    readonly targetRichSamples: number;
  };
  readonly distributions: {
    readonly targetSpreadBps: Distribution;
    readonly absoluteMidDislocationBps: Distribution;
    readonly referenceDispersionBps: Distribution;
    readonly selectedMakerGrossEdgeBps: Distribution;
    readonly selectedTopQuantity: Distribution;
  };
  readonly highConfidenceThresholds: {
    readonly absoluteMidDislocationBps: Readonly<
      Record<string, ThresholdObservation>
    >;
    readonly selectedMakerGrossEdgeBps: Readonly<
      Record<string, ThresholdObservation>
    >;
  };
  readonly highConfidenceEpisodes: Readonly<
    Record<string, EpisodeSummary>
  >;
  readonly byUtcDate: Readonly<Record<string, DateSummary>>;
  readonly economicBearing: {
    readonly classification:
      | "no_material_checkpoint_dislocation"
      | "thin_gross_margins"
      | "material_dislocation_requires_fill_replay";
    readonly isProfitabilityResult: false;
    readonly blockers: readonly string[];
  };
}

const targetKey = "coinbase|EURC-USDC";
const referenceKeys = [
  "binance|EUR-USDC",
  "bybit|USDC-EUR",
  "kraken|USDC-EUR"
] as const;

function checkpointKey(event: BookCheckpointEvent): string {
  return `${event.venue}|${event.product}`;
}

function midpoint(event: BookCheckpointEvent): number {
  return (
    (Number(event.payload.bids[0]!.price) +
      Number(event.payload.asks[0]!.price)) /
    2
  );
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle]!;
  }
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function percentile(
  values: readonly number[],
  fraction: number
): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.floor((sorted.length - 1) * fraction)
  );
  return sorted[index]!;
}

function distribution(values: readonly number[]): Distribution {
  return {
    p05: percentile(values, 0.05),
    p25: percentile(values, 0.25),
    p50: percentile(values, 0.5),
    p75: percentile(values, 0.75),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
    maximum: values.length === 0 ? null : Math.max(...values)
  };
}

function thresholds(
  samples: readonly CheckpointSample[],
  value: (sample: CheckpointSample) => number
): Readonly<Record<string, ThresholdObservation>> {
  return Object.fromEntries(
    [1, 2, 3, 5, 10].map((threshold) => {
      const count = samples.filter(
        (sample) => value(sample) >= threshold
      ).length;
      return [
        `${threshold}bp`,
        {
          count,
          share: samples.length === 0 ? 0 : count / samples.length
        }
      ];
    })
  );
}

function episodes(
  samples: readonly CheckpointSample[],
  threshold: number,
  maximumGapMs: number
): EpisodeSummary {
  let count = 0;
  let maximumDurationMs = 0;
  let start: number | undefined;
  let previous: number | undefined;
  for (const sample of samples) {
    const qualifies = sample.absoluteDislocationBps >= threshold;
    if (!qualifies) {
      start = undefined;
      previous = sample.receivedTimestampMs;
      continue;
    }
    if (
      start === undefined ||
      previous === undefined ||
      sample.receivedTimestampMs - previous > maximumGapMs
    ) {
      start = sample.receivedTimestampMs;
      count += 1;
    }
    maximumDurationMs = Math.max(
      maximumDurationMs,
      sample.receivedTimestampMs - start
    );
    previous = sample.receivedTimestampMs;
  }
  return {
    count,
    maximumMinutes: maximumDurationMs / 60_000
  };
}

function byDate(
  samples: readonly CheckpointSample[]
): Readonly<Record<string, DateSummary>> {
  const grouped = new Map<string, CheckpointSample[]>();
  for (const sample of samples) {
    const entries = grouped.get(sample.utcDate) ?? [];
    entries.push(sample);
    grouped.set(sample.utcDate, entries);
  }
  return Object.fromEntries(
    [...grouped.entries()].map(([date, entries]) => {
      const values = entries.map(
        (entry) => entry.absoluteDislocationBps
      );
      return [
        date,
        {
          samples: entries.length,
          medianAbsoluteDislocationBps: percentile(values, 0.5),
          p95AbsoluteDislocationBps: percentile(values, 0.95),
          maximumAbsoluteDislocationBps:
            values.length === 0 ? null : Math.max(...values),
          atLeast2Bps: values.filter((value) => value >= 2).length,
          atLeast3Bps: values.filter((value) => value >= 3).length
        }
      ];
    })
  );
}

function classify(
  highConfidenceSamples: readonly CheckpointSample[]
): CorridorCheckpointScanReport["economicBearing"]["classification"] {
  const maximum = Math.max(
    0,
    ...highConfidenceSamples.map(
      (sample) => sample.absoluteDislocationBps
    )
  );
  if (maximum < 2) {
    return "no_material_checkpoint_dislocation";
  }
  if (maximum < 5) {
    return "thin_gross_margins";
  }
  return "material_dislocation_requires_fill_replay";
}

function summedDailyObservationHours(
  samples: readonly CheckpointSample[]
): number | null {
  if (samples.length === 0) {
    return null;
  }
  const ranges = new Map<
    string,
    { first: number; last: number }
  >();
  for (const sample of samples) {
    const range = ranges.get(sample.utcDate);
    if (range === undefined) {
      ranges.set(sample.utcDate, {
        first: sample.receivedTimestampMs,
        last: sample.receivedTimestampMs
      });
    } else {
      range.first = Math.min(range.first, sample.receivedTimestampMs);
      range.last = Math.max(range.last, sample.receivedTimestampMs);
    }
  }
  return (
    [...ranges.values()].reduce(
      (total, range) => total + range.last - range.first,
      0
    ) / 3_600_000
  );
}

export async function scanCorridorCheckpoints(
  positions: AsyncIterable<ReplayPosition>,
  options: CorridorCheckpointScanOptions
): Promise<CorridorCheckpointScanReport> {
  const freshnessMs = options.freshnessMs ?? 90_000;
  const maxReferenceDispersionBps =
    options.maxReferenceDispersionBps ?? 2;
  const targetSampleIntervalMs =
    options.targetSampleIntervalMs ?? 0;
  if (
    !Number.isSafeInteger(targetSampleIntervalMs) ||
    targetSampleIntervalMs < 0
  ) {
    throw new Error(
      `Invalid target sample interval: ${targetSampleIntervalMs}`
    );
  }
  const latest = new Map<string, BookCheckpointEvent>();
  const samples: CheckpointSample[] = [];
  let totalCheckpointEvents = 0;
  let lastTargetSampleTimestampMs: number | undefined;

  for await (const { event } of positions) {
    if (
      event.collectorRunId !== options.collectorRunId ||
      event.eventType !== "book_checkpoint"
    ) {
      continue;
    }
    totalCheckpointEvents += 1;
    const key = checkpointKey(event);
    latest.set(key, event);
    if (key !== targetKey) {
      continue;
    }
    if (
      lastTargetSampleTimestampMs !== undefined &&
      event.receivedTimestampMs - lastTargetSampleTimestampMs <
        targetSampleIntervalMs
    ) {
      continue;
    }
    lastTargetSampleTimestampMs = event.receivedTimestampMs;

    const references: number[] = [];
    let referencesFresh = true;
    for (const referenceKey of referenceKeys) {
      const reference = latest.get(referenceKey);
      if (
        reference === undefined ||
        event.receivedTimestampMs -
          reference.receivedTimestampMs >
          freshnessMs
      ) {
        referencesFresh = false;
        break;
      }
      const value = midpoint(reference);
      references.push(
        reference.product === "USDC-EUR" ? 1 / value : value
      );
    }
    if (!referencesFresh) {
      continue;
    }

    const fairValue = median(references);
    const bid = Number(event.payload.bids[0]!.price);
    const ask = Number(event.payload.asks[0]!.price);
    const targetMid = (bid + ask) / 2;
    const dislocationBps =
      ((targetMid - fairValue) / fairValue) * 10_000;
    const targetCheap = dislocationBps <= 0;
    samples.push({
      receivedTimestampMs: event.receivedTimestampMs,
      utcDate: new Date(event.receivedTimestampMs)
        .toISOString()
        .slice(0, 10),
      spreadBps: ((ask - bid) / targetMid) * 10_000,
      dislocationBps,
      absoluteDislocationBps: Math.abs(dislocationBps),
      referenceDispersionBps:
        ((Math.max(...references) - Math.min(...references)) /
          fairValue) *
        10_000,
      selectedMakerGrossEdgeBps: targetCheap
        ? ((fairValue - bid) / fairValue) * 10_000
        : ((ask - fairValue) / fairValue) * 10_000,
      selectedTopQuantity: targetCheap
        ? Number(event.payload.bids[0]!.quantity)
        : Number(event.payload.asks[0]!.quantity)
    });
  }

  const highConfidenceSamples = samples.filter(
    (sample) =>
      sample.referenceDispersionBps <= maxReferenceDispersionBps
  );
  const first = samples[0]?.receivedTimestampMs;
  const last = samples.at(-1)?.receivedTimestampMs;
  const maximumEpisodeGapMs = Math.max(freshnessMs, 90_000);
  return {
    schemaVersion: 1,
    reportType: "stable_corridor_checkpoint_edge_screen",
    collectorRunId: options.collectorRunId,
    target: targetKey,
    referenceRoutes: [
      "binance|EUR-USDC",
      "bybit|USDC-EUR inverted",
      "kraken|USDC-EUR inverted"
    ],
    freshnessMs,
    maxReferenceDispersionBps,
    targetSampleIntervalMs,
    observations: {
      totalCheckpointEvents,
      eligibleTargetSamples: samples.length,
      highConfidenceSamples: highConfidenceSamples.length,
      firstReceivedTimestampMs: first ?? null,
      lastReceivedTimestampMs: last ?? null,
      elapsedHours:
        first === undefined || last === undefined
          ? null
          : (last - first) / 3_600_000,
      observedUtcDates: new Set(
        samples.map((sample) => sample.utcDate)
      ).size,
      summedDailyObservationHours:
        summedDailyObservationHours(samples),
      targetCheapSamples: highConfidenceSamples.filter(
        (sample) => sample.dislocationBps <= 0
      ).length,
      targetRichSamples: highConfidenceSamples.filter(
        (sample) => sample.dislocationBps > 0
      ).length
    },
    distributions: {
      targetSpreadBps: distribution(
        highConfidenceSamples.map((sample) => sample.spreadBps)
      ),
      absoluteMidDislocationBps: distribution(
        highConfidenceSamples.map(
          (sample) => sample.absoluteDislocationBps
        )
      ),
      referenceDispersionBps: distribution(
        samples.map((sample) => sample.referenceDispersionBps)
      ),
      selectedMakerGrossEdgeBps: distribution(
        highConfidenceSamples.map(
          (sample) => sample.selectedMakerGrossEdgeBps
        )
      ),
      selectedTopQuantity: distribution(
        highConfidenceSamples.map(
          (sample) => sample.selectedTopQuantity
        )
      )
    },
    highConfidenceThresholds: {
      absoluteMidDislocationBps: thresholds(
        highConfidenceSamples,
        (sample) => sample.absoluteDislocationBps
      ),
      selectedMakerGrossEdgeBps: thresholds(
        highConfidenceSamples,
        (sample) => sample.selectedMakerGrossEdgeBps
      )
    },
    highConfidenceEpisodes: Object.fromEntries(
      [2, 3, 5].map((threshold) => [
        `${threshold}bp`,
        episodes(
          highConfidenceSamples,
          threshold,
          maximumEpisodeGapMs
        )
      ])
    ),
    byUtcDate: byDate(highConfidenceSamples),
    economicBearing: {
      classification: classify(highConfidenceSamples),
      isProfitabilityResult: false,
      blockers: [
        "Checkpoint sampling does not establish maker fills or queue position.",
        "Gross edge excludes adverse selection, inventory carry, and rebalancing.",
        "The independent reference composite is crypto-market-derived, not licensed conventional FX.",
        "The observation window is shorter than the 45-60 day research gate."
      ]
    }
  };
}
