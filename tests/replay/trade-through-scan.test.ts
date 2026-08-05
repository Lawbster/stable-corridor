import { describe, expect, it } from "vitest";

import {
  scanTradeThrough
} from "../../src/opportunity/trade-through-scan.js";
import type { ReplayPosition } from "../../src/replay/order.js";
import {
  makeBookCheckpointEvent,
  makeTradeEvent,
  type BookCheckpointEventOverrides
} from "../fixtures/events.js";

const collectorRunId = "11111111-1111-4111-8111-111111111111";

function checkpointPosition(
  overrides: BookCheckpointEventOverrides,
  lineNumber: number
): ReplayPosition {
  return {
    event: makeBookCheckpointEvent({
      collectorRunId,
      ...overrides
    }),
    journalId: `${overrides.venue}|${overrides.product}|checkpoint`,
    lineNumber
  };
}

function tradePosition(
  options: {
    readonly receivedTimestampMs: number;
    readonly ingestSequence: number;
    readonly price: string;
    readonly quantity: string;
    readonly side: "buy" | "sell";
  },
  lineNumber: number
): ReplayPosition {
  const event = makeTradeEvent({
    collectorRunId,
    venue: "coinbase",
    product: "EURC-USDC",
    receivedTimestampMs: options.receivedTimestampMs,
    ingestSequence: options.ingestSequence,
    price: options.price,
    quantity: options.quantity
  });
  return {
    event: {
      ...event,
      payload: {
        ...event.payload,
        aggressorSide: options.side
      }
    },
    journalId: "coinbase|EURC-USDC|trade",
    lineNumber
  };
}

async function* stream(
  entries: readonly ReplayPosition[]
): AsyncGenerator<ReplayPosition> {
  for (const entry of entries) {
    yield entry;
  }
}

function references(timestampMs: number): ReplayPosition[] {
  const inverseFair = "0.8695652173913043";
  return [
    checkpointPosition(
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
    checkpointPosition(
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
    checkpointPosition(
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

describe("maker trade-through screen", () => {
  it("requires queue-clearing aggressor flow after acknowledgement", async () => {
    const timestampMs = Date.UTC(2026, 7, 5, 12, 0, 0);
    const target = checkpointPosition(
      {
        venue: "coinbase",
        product: "EURC-USDC",
        receivedTimestampMs: timestampMs + 3,
        ingestSequence: 4,
        bidPrice: "1.1494",
        askPrice: "1.1498",
        bidQuantity: "50"
      },
      1
    );
    const report = await scanTradeThrough(
      stream([
        ...references(timestampMs),
        target,
        tradePosition(
          {
            receivedTimestampMs: timestampMs + 103,
            ingestSequence: 5,
            price: "1.1494",
            quantity: "1000",
            side: "sell"
          },
          1
        ),
        tradePosition(
          {
            receivedTimestampMs: timestampMs + 503,
            ingestSequence: 6,
            price: "1.1494",
            quantity: "50",
            side: "sell"
          },
          2
        ),
        tradePosition(
          {
            receivedTimestampMs: timestampMs + 1_003,
            ingestSequence: 7,
            price: "1.1494",
            quantity: "100",
            side: "sell"
          },
          3
        )
      ]),
      {
        collectorRunId,
        orderQuantity: 100,
        acknowledgementLatencyMs: 250
      }
    );

    expect(report.signals).toEqual({ total: 1, buy: 1, sell: 0 });
    expect(report.horizons["5000ms"]).toMatchObject({
      touched: 1,
      queueCleared: 1,
      fullOrder: 1
    });
    expect(report.candidates[0]).toMatchObject({
      qualifyingTradeQuantity: 150,
      firstTouchAfterMs: 500,
      queueClearedAfterMs: 1_000,
      fullOrderAfterMs: 1_000
    });
  });

  it("deduplicates a continuing checkpoint episode", async () => {
    const timestampMs = Date.UTC(2026, 7, 5, 12, 0, 0);
    const target = (
      receivedTimestampMs: number,
      ingestSequence: number
    ): ReplayPosition =>
      checkpointPosition(
        {
          venue: "coinbase",
          product: "EURC-USDC",
          receivedTimestampMs,
          ingestSequence,
          bidPrice: "1.1494",
          askPrice: "1.1498",
          bidQuantity: "50"
        },
        ingestSequence
      );

    const report = await scanTradeThrough(
      stream([
        ...references(timestampMs),
        target(timestampMs + 3, 4),
        target(timestampMs + 60_003, 5)
      ]),
      { collectorRunId }
    );
    expect(report.signals.total).toBe(1);
  });

  it("does not count opposite aggressor flow as a touch", async () => {
    const timestampMs = Date.UTC(2026, 7, 5, 12, 0, 0);
    const report = await scanTradeThrough(
      stream([
        ...references(timestampMs),
        checkpointPosition(
          {
            venue: "coinbase",
            product: "EURC-USDC",
            receivedTimestampMs: timestampMs + 3,
            ingestSequence: 4,
            bidPrice: "1.1494",
            askPrice: "1.1498",
            bidQuantity: "50"
          },
          1
        ),
        tradePosition(
          {
            receivedTimestampMs: timestampMs + 1_003,
            ingestSequence: 5,
            price: "1.1494",
            quantity: "1000",
            side: "buy"
          },
          1
        )
      ]),
      { collectorRunId }
    );
    expect(report.horizons["60000ms"]).toMatchObject({
      touched: 0,
      queueCleared: 0,
      fullOrder: 0
    });
    expect(report.economicBearing.classification).toBe(
      "no_fill_plausibility"
    );
  });
});
