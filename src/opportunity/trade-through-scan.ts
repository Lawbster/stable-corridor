import type {
  NormalizedEvent
} from "../collector/schema/events.js";
import type { ReplayPosition } from "../replay/order.js";

type BookCheckpointEvent = Extract<
  NormalizedEvent,
  { readonly eventType: "book_checkpoint" }
>;

export interface TradeThroughScanOptions {
  readonly collectorRunId: string;
  readonly freshnessMs?: number;
  readonly maxReferenceDispersionBps?: number;
  readonly minimumDislocationBps?: number;
  readonly acknowledgementLatencyMs?: number;
  readonly horizonMs?: number;
  readonly orderQuantity?: number;
}

export interface TradeThroughCandidate {
  readonly receivedTimestampMs: number;
  readonly side: "buy" | "sell";
  readonly quotePrice: number;
  readonly visibleQueueQuantity: number;
  readonly absoluteDislocationBps: number;
  readonly selectedMakerGrossEdgeBps: number;
  readonly qualifyingTradeQuantity: number;
  readonly firstTouchAfterMs: number | null;
  readonly queueClearedAfterMs: number | null;
  readonly fullOrderAfterMs: number | null;
}

interface HorizonSummary {
  readonly signals: number;
  readonly touched: number;
  readonly touchShare: number;
  readonly queueCleared: number;
  readonly queueClearShare: number;
  readonly fullOrder: number;
  readonly fullOrderShare: number;
}

interface Distribution {
  readonly p50: number | null;
  readonly p75: number | null;
  readonly p95: number | null;
  readonly maximum: number | null;
}

interface SizeSensitivity {
  readonly orderQuantity: number;
  readonly proxyFullFills: number;
  readonly proxyFullFillShare: number;
  readonly grossMarkToFairQuote: number;
  readonly grossMarkToFairQuotePerDay: number | null;
  readonly after1BpBufferQuotePerDay: number | null;
  readonly after2BpBufferQuotePerDay: number | null;
}

export interface TradeThroughScanReport {
  readonly schemaVersion: 1;
  readonly reportType: "stable_corridor_trade_through_screen";
  readonly collectorRunId: string;
  readonly target: "coinbase|EURC-USDC";
  readonly parameters: {
    readonly freshnessMs: number;
    readonly maxReferenceDispersionBps: number;
    readonly minimumDislocationBps: number;
    readonly acknowledgementLatencyMs: number;
    readonly horizonMs: number;
    readonly orderQuantity: number;
  };
  readonly signals: {
    readonly total: number;
    readonly buy: number;
    readonly sell: number;
  };
  readonly observationElapsedHours: number | null;
  readonly horizons: Readonly<Record<string, HorizonSummary>>;
  readonly qualifyingTradeToVisibleQueueRatio: Distribution;
  readonly sizeSensitivity: readonly SizeSensitivity[];
  readonly economicBearing: {
    readonly classification:
      | "no_fill_plausibility"
      | "limited_queue_clearance"
      | "material_queue_clearance";
    readonly isProfitabilityResult: false;
    readonly blockers: readonly string[];
  };
  readonly candidates: readonly TradeThroughCandidate[];
}

interface MutableCandidate {
  readonly receivedTimestampMs: number;
  readonly side: "buy" | "sell";
  readonly quotePrice: number;
  readonly visibleQueueQuantity: number;
  readonly absoluteDislocationBps: number;
  readonly selectedMakerGrossEdgeBps: number;
  qualifyingTradeQuantity: number;
  firstTouchAfterMs?: number;
  queueClearedAfterMs?: number;
  fullOrderAfterMs?: number;
}

interface PriorSignalState {
  readonly qualified: boolean;
  readonly receivedTimestampMs: number;
  readonly side?: "buy" | "sell";
}

const targetKey = "coinbase|EURC-USDC";
const referenceKeys = [
  "binance|EUR-USDC",
  "bybit|USDC-EUR",
  "kraken|USDC-EUR"
] as const;

function eventKey(event: {
  readonly venue: string;
  readonly product: string;
}): string {
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
  return [...values].sort((left, right) => left - right)[1]!;
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
    p50: percentile(values, 0.5),
    p75: percentile(values, 0.75),
    p95: percentile(values, 0.95),
    maximum: values.length === 0 ? null : Math.max(...values)
  };
}

function horizonSummary(
  candidates: readonly MutableCandidate[],
  horizonMs: number
): HorizonSummary {
  const touched = candidates.filter(
    (candidate) =>
      candidate.firstTouchAfterMs !== undefined &&
      candidate.firstTouchAfterMs <= horizonMs
  ).length;
  const queueCleared = candidates.filter(
    (candidate) =>
      candidate.queueClearedAfterMs !== undefined &&
      candidate.queueClearedAfterMs <= horizonMs
  ).length;
  const fullOrder = candidates.filter(
    (candidate) =>
      candidate.fullOrderAfterMs !== undefined &&
      candidate.fullOrderAfterMs <= horizonMs
  ).length;
  return {
    signals: candidates.length,
    touched,
    touchShare:
      candidates.length === 0 ? 0 : touched / candidates.length,
    queueCleared,
    queueClearShare:
      candidates.length === 0
        ? 0
        : queueCleared / candidates.length,
    fullOrder,
    fullOrderShare:
      candidates.length === 0 ? 0 : fullOrder / candidates.length
  };
}

function candidateResult(
  candidate: MutableCandidate
): TradeThroughCandidate {
  return {
    receivedTimestampMs: candidate.receivedTimestampMs,
    side: candidate.side,
    quotePrice: candidate.quotePrice,
    visibleQueueQuantity: candidate.visibleQueueQuantity,
    absoluteDislocationBps: candidate.absoluteDislocationBps,
    selectedMakerGrossEdgeBps:
      candidate.selectedMakerGrossEdgeBps,
    qualifyingTradeQuantity: candidate.qualifyingTradeQuantity,
    firstTouchAfterMs: candidate.firstTouchAfterMs ?? null,
    queueClearedAfterMs: candidate.queueClearedAfterMs ?? null,
    fullOrderAfterMs: candidate.fullOrderAfterMs ?? null
  };
}

function classify(
  candidates: readonly MutableCandidate[]
): TradeThroughScanReport["economicBearing"]["classification"] {
  const cleared = candidates.filter(
    (candidate) => candidate.queueClearedAfterMs !== undefined
  ).length;
  const share =
    candidates.length === 0 ? 0 : cleared / candidates.length;
  if (share === 0) {
    return "no_fill_plausibility";
  }
  if (share < 0.25) {
    return "limited_queue_clearance";
  }
  return "material_queue_clearance";
}

function sizeSensitivity(
  candidates: readonly MutableCandidate[],
  observationElapsedHours: number | null
): readonly SizeSensitivity[] {
  const days =
    observationElapsedHours === null
      ? null
      : observationElapsedHours / 24;
  return [100, 500, 1_000, 5_000, 10_000].map(
    (orderQuantity) => {
      const full = candidates.filter(
        (candidate) =>
          candidate.qualifyingTradeQuantity >=
          candidate.visibleQueueQuantity + orderQuantity
      );
      const gross = (
        bufferBps: number
      ): number =>
        full.reduce(
          (total, candidate) =>
            total +
            (orderQuantity *
              candidate.quotePrice *
              Math.max(
                0,
                candidate.selectedMakerGrossEdgeBps - bufferBps
              )) /
              10_000,
          0
        );
      const grossMarkToFairQuote = gross(0);
      return {
        orderQuantity,
        proxyFullFills: full.length,
        proxyFullFillShare:
          candidates.length === 0
            ? 0
            : full.length / candidates.length,
        grossMarkToFairQuote,
        grossMarkToFairQuotePerDay:
          days === null || days === 0
            ? null
            : grossMarkToFairQuote / days,
        after1BpBufferQuotePerDay:
          days === null || days === 0 ? null : gross(1) / days,
        after2BpBufferQuotePerDay:
          days === null || days === 0 ? null : gross(2) / days
      };
    }
  );
}

export async function scanTradeThrough(
  positions: AsyncIterable<ReplayPosition>,
  options: TradeThroughScanOptions
): Promise<TradeThroughScanReport> {
  const freshnessMs = options.freshnessMs ?? 90_000;
  const maxReferenceDispersionBps =
    options.maxReferenceDispersionBps ?? 2;
  const minimumDislocationBps =
    options.minimumDislocationBps ?? 2;
  const acknowledgementLatencyMs =
    options.acknowledgementLatencyMs ?? 250;
  const horizonMs = options.horizonMs ?? 60_000;
  const orderQuantity = options.orderQuantity ?? 100;
  for (const [label, value] of [
    ["freshnessMs", freshnessMs],
    ["minimumDislocationBps", minimumDislocationBps],
    ["acknowledgementLatencyMs", acknowledgementLatencyMs],
    ["horizonMs", horizonMs],
    ["orderQuantity", orderQuantity]
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid ${label}: ${value}`);
    }
  }

  const latest = new Map<string, BookCheckpointEvent>();
  const candidates: MutableCandidate[] = [];
  let priorSignal: PriorSignalState = {
    qualified: false,
    receivedTimestampMs: 0
  };
  let firstTargetTimestampMs: number | undefined;
  let lastTargetTimestampMs: number | undefined;

  for await (const { event } of positions) {
    if (event.collectorRunId !== options.collectorRunId) {
      continue;
    }
    const key = eventKey(event);
    if (event.eventType === "book_checkpoint") {
      latest.set(key, event);
      if (key !== targetKey) {
        continue;
      }
      firstTargetTimestampMs ??= event.receivedTimestampMs;
      lastTargetTimestampMs = event.receivedTimestampMs;

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
        priorSignal = {
          qualified: false,
          receivedTimestampMs: event.receivedTimestampMs
        };
        continue;
      }

      const fairValue = median(references);
      const targetMid = midpoint(event);
      const dislocationBps =
        ((targetMid - fairValue) / fairValue) * 10_000;
      const side = dislocationBps <= 0 ? "buy" : "sell";
      const absoluteDislocationBps = Math.abs(dislocationBps);
      const referenceDispersionBps =
        ((Math.max(...references) - Math.min(...references)) /
          fairValue) *
        10_000;
      const qualified =
        absoluteDislocationBps >= minimumDislocationBps &&
        referenceDispersionBps <= maxReferenceDispersionBps;
      const continuesPriorEpisode =
        priorSignal.qualified &&
        priorSignal.side === side &&
        event.receivedTimestampMs -
          priorSignal.receivedTimestampMs <=
          Math.max(freshnessMs, 90_000);
      if (qualified && !continuesPriorEpisode) {
        const level =
          side === "buy"
            ? event.payload.bids[0]!
            : event.payload.asks[0]!;
        const quotePrice = Number(level.price);
        const visibleQueueQuantity = Number(level.quantity);
        if (visibleQueueQuantity <= 0) {
          throw new Error(
            "Signal checkpoint has a non-positive visible queue"
          );
        }
        candidates.push({
          receivedTimestampMs: event.receivedTimestampMs,
          side,
          quotePrice,
          visibleQueueQuantity,
          absoluteDislocationBps,
          selectedMakerGrossEdgeBps:
            side === "buy"
              ? ((fairValue - quotePrice) / fairValue) * 10_000
              : ((quotePrice - fairValue) / fairValue) * 10_000,
          qualifyingTradeQuantity: 0
        });
      }
      priorSignal = {
        qualified,
        receivedTimestampMs: event.receivedTimestampMs,
        side
      };
      continue;
    }

    if (event.eventType !== "trade" || key !== targetKey) {
      continue;
    }
    const tradePrice = Number(event.payload.price);
    const tradeQuantity = Number(event.payload.quantity);
    for (const candidate of candidates) {
      const elapsedMs =
        event.receivedTimestampMs - candidate.receivedTimestampMs;
      if (
        elapsedMs < acknowledgementLatencyMs ||
        elapsedMs > horizonMs
      ) {
        continue;
      }
      const qualifies =
        candidate.side === "buy"
          ? event.payload.aggressorSide === "sell" &&
            tradePrice <= candidate.quotePrice
          : event.payload.aggressorSide === "buy" &&
            tradePrice >= candidate.quotePrice;
      if (!qualifies) {
        continue;
      }
      candidate.qualifyingTradeQuantity += tradeQuantity;
      candidate.firstTouchAfterMs ??= elapsedMs;
      if (
        candidate.queueClearedAfterMs === undefined &&
        candidate.qualifyingTradeQuantity >
          candidate.visibleQueueQuantity
      ) {
        candidate.queueClearedAfterMs = elapsedMs;
      }
      if (
        candidate.fullOrderAfterMs === undefined &&
        candidate.qualifyingTradeQuantity >=
          candidate.visibleQueueQuantity + orderQuantity
      ) {
        candidate.fullOrderAfterMs = elapsedMs;
      }
    }
  }

  const ratios = candidates.map(
    (candidate) =>
      candidate.qualifyingTradeQuantity /
      candidate.visibleQueueQuantity
  );
  const observationElapsedHours =
    firstTargetTimestampMs === undefined ||
    lastTargetTimestampMs === undefined
      ? null
      : (lastTargetTimestampMs - firstTargetTimestampMs) /
        3_600_000;
  return {
    schemaVersion: 1,
    reportType: "stable_corridor_trade_through_screen",
    collectorRunId: options.collectorRunId,
    target: targetKey,
    parameters: {
      freshnessMs,
      maxReferenceDispersionBps,
      minimumDislocationBps,
      acknowledgementLatencyMs,
      horizonMs,
      orderQuantity
    },
    signals: {
      total: candidates.length,
      buy: candidates.filter(
        (candidate) => candidate.side === "buy"
      ).length,
      sell: candidates.filter(
        (candidate) => candidate.side === "sell"
      ).length
    },
    observationElapsedHours,
    horizons: Object.fromEntries(
      [5_000, 30_000, horizonMs].map((value) => [
        `${value}ms`,
        horizonSummary(candidates, value)
      ])
    ),
    qualifyingTradeToVisibleQueueRatio: distribution(ratios),
    sizeSensitivity: sizeSensitivity(
      candidates,
      observationElapsedHours
    ),
    economicBearing: {
      classification: classify(candidates),
      isProfitabilityResult: false,
      blockers: [
        "Trade-through is not exchange-confirmed fill evidence.",
        "The proxy assumes arrival at the displayed queue tail after the configured latency.",
        "Queue cancellations and additions are not reconstructed.",
        "Gross edge excludes adverse selection, inventory carry, exit fills, and rebalancing.",
        "Overlapping signal windows are research observations, not independent PnL."
      ]
    },
    candidates: candidates.map(candidateResult)
  };
}
