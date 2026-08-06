import { describe, expect, it } from "vitest";

import {
  scanCorridorCheckpoints
} from "../../src/opportunity/checkpoint-scan.js";
import type { ReplayPosition } from "../../src/replay/order.js";
import {
  makeBookCheckpointEvent,
  type BookCheckpointEventOverrides
} from "../fixtures/events.js";

const collectorRunId = "11111111-1111-4111-8111-111111111111";

function position(
  overrides: BookCheckpointEventOverrides,
  lineNumber: number
): ReplayPosition {
  return {
    event: makeBookCheckpointEvent({
      collectorRunId,
      ...overrides
    }),
    journalId: `${overrides.venue}|${overrides.product}`,
    lineNumber
  };
}

async function* positions(
  entries: readonly ReplayPosition[]
): AsyncGenerator<ReplayPosition> {
  for (const entry of entries) {
    yield entry;
  }
}

function references(timestampMs: number): ReplayPosition[] {
  const inverseFair = "0.8695652173913043";
  return [
    position(
      {
        venue: "binance",
        product: "EUR-USDC",
        receivedTimestampMs: timestampMs,
        ingestSequence: 1,
        bidPrice: "1.15",
        askPrice: "1.15"
      },
      1
    ),
    position(
      {
        venue: "bybit",
        product: "USDC-EUR",
        receivedTimestampMs: timestampMs + 1,
        ingestSequence: 2,
        bidPrice: inverseFair,
        askPrice: inverseFair
      },
      1
    ),
    position(
      {
        venue: "kraken",
        product: "USDC-EUR",
        receivedTimestampMs: timestampMs + 2,
        ingestSequence: 3,
        bidPrice: inverseFair,
        askPrice: inverseFair
      },
      1
    )
  ];
}

describe("checkpoint corridor edge screen", () => {
  it("uses only references received before the target checkpoint", async () => {
    const timestampMs = Date.UTC(2026, 7, 5, 12, 0, 0);
    const targetBeforeReferences = position(
      {
        venue: "coinbase",
        product: "EURC-USDC",
        receivedTimestampMs: timestampMs,
        ingestSequence: 0,
        bidPrice: "1.1498",
        askPrice: "1.15"
      },
      1
    );
    const targetAfterReferences = position(
      {
        venue: "coinbase",
        product: "EURC-USDC",
        receivedTimestampMs: timestampMs + 3,
        ingestSequence: 4,
        bidPrice: "1.1498",
        askPrice: "1.15"
      },
      2
    );

    const report = await scanCorridorCheckpoints(
      positions([
        targetBeforeReferences,
        ...references(timestampMs),
        targetAfterReferences
      ]),
      { collectorRunId }
    );
    expect(report.observations.eligibleTargetSamples).toBe(1);
    expect(report.observations.highConfidenceSamples).toBe(1);
  });

  it("classifies sub-five-basis-point dislocations as thin", async () => {
    const timestampMs = Date.UTC(2026, 7, 5, 12, 0, 0);
    const target = position(
      {
        venue: "coinbase",
        product: "EURC-USDC",
        receivedTimestampMs: timestampMs + 3,
        ingestSequence: 4,
        bidPrice: "1.1494",
        askPrice: "1.1498",
        bidQuantity: "500",
        askQuantity: "600"
      },
      1
    );

    const report = await scanCorridorCheckpoints(
      positions([...references(timestampMs), target]),
      { collectorRunId }
    );
    expect(
      report.distributions.absoluteMidDislocationBps.maximum
    ).toBeGreaterThan(2);
    expect(
      report.distributions.absoluteMidDislocationBps.maximum
    ).toBeLessThan(5);
    expect(report.economicBearing).toMatchObject({
      classification: "thin_gross_margins",
      isProfitabilityResult: false
    });
    expect(
      report.highConfidenceThresholds.absoluteMidDislocationBps[
        "2bp"
      ]
    ).toMatchObject({ count: 1, share: 1 });
  });

  it("rejects stale or internally dispersed reference sets", async () => {
    const timestampMs = Date.UTC(2026, 7, 5, 12, 0, 0);
    const target = position(
      {
        venue: "coinbase",
        product: "EURC-USDC",
        receivedTimestampMs: timestampMs + 120_000,
        ingestSequence: 4,
        bidPrice: "1.1494",
        askPrice: "1.1498"
      },
      1
    );
    const stale = await scanCorridorCheckpoints(
      positions([...references(timestampMs), target]),
      {
        collectorRunId,
        freshnessMs: 90_000
      }
    );
    expect(stale.observations.eligibleTargetSamples).toBe(0);

    const dispersedReferences = references(timestampMs);
    dispersedReferences[0] = position(
      {
        venue: "binance",
        product: "EUR-USDC",
        receivedTimestampMs: timestampMs,
        ingestSequence: 1,
        bidPrice: "1.14",
        askPrice: "1.14"
      },
      1
    );
    const dispersed = await scanCorridorCheckpoints(
      positions([
        ...dispersedReferences,
        position(
          {
            venue: "coinbase",
            product: "EURC-USDC",
            receivedTimestampMs: timestampMs + 3,
            ingestSequence: 4
          },
          1
        )
      ]),
      {
        collectorRunId,
        maxReferenceDispersionBps: 2
      }
    );
    expect(dispersed.observations.eligibleTargetSamples).toBe(1);
    expect(dispersed.observations.highConfidenceSamples).toBe(0);
  });

  it("supports a bounded target sampling cadence", async () => {
    const timestampMs = Date.UTC(2026, 7, 5, 12, 0, 0);
    const target = (
      offsetMs: number,
      ingestSequence: number
    ): ReplayPosition =>
      position(
        {
          venue: "coinbase",
          product: "EURC-USDC",
          receivedTimestampMs: timestampMs + offsetMs,
          ingestSequence,
          bidPrice: "1.1494",
          askPrice: "1.1498"
        },
        ingestSequence
      );
    const report = await scanCorridorCheckpoints(
      positions([
        ...references(timestampMs),
        target(3, 4),
        target(30_003, 5),
        target(60_003, 6)
      ]),
      {
        collectorRunId,
        targetSampleIntervalMs: 60_000
      }
    );
    expect(report.targetSampleIntervalMs).toBe(60_000);
    expect(report.observations.eligibleTargetSamples).toBe(2);
  });
});
