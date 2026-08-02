import { describe, expect, it } from "vitest";

import {
  assertReplayPositionsMonotonic,
  compareReplayPositions,
  isAvailableAtDecisionTime,
  type ReplayPosition
} from "../../src/replay/order.js";
import {
  canonicalStringify
} from "../../src/collector/serialization.js";
import { makeTradeEvent } from "../fixtures/events.js";

function position(
  overrides: Parameters<typeof makeTradeEvent>[0],
  lineNumber: number,
  journalId = "coinbase/EURC-USDC/trade"
): ReplayPosition {
  return {
    event: makeTradeEvent(overrides),
    journalId,
    lineNumber
  };
}

describe("receive-time replay ordering", () => {
  it("orders same-run events by receive time then ingest sequence", () => {
    const laterIngest = position(
      { receivedTimestampMs: 1_000, ingestSequence: 2 },
      2
    );
    const earlierIngest = position(
      { receivedTimestampMs: 1_000, ingestSequence: 1 },
      1
    );

    const sorted = [laterIngest, earlierIngest].sort(
      compareReplayPositions
    );
    expect(sorted).toEqual([earlierIngest, laterIngest]);
    expect(() => assertReplayPositionsMonotonic(sorted)).not.toThrow();
  });

  it("never exposes an event using its earlier source timestamp", () => {
    const event = makeTradeEvent({
      sourceTimestampMs: 1_000,
      receivedTimestampMs: 2_000
    });
    expect(isAvailableAtDecisionTime(event, 1_999)).toBe(false);
    expect(isAvailableAtDecisionTime(event, 2_000)).toBe(true);
  });

  it("keeps prior decision inputs unchanged when a future price is added", () => {
    const decisionTimestampMs = 1_500;
    const current = position(
      {
        receivedTimestampMs: 1_000,
        ingestSequence: 1,
        price: "1.1521"
      },
      1
    );
    const future = position(
      {
        receivedTimestampMs: 2_000,
        ingestSequence: 2,
        price: "999"
      },
      2
    );

    const snapshot = (positions: readonly ReplayPosition[]): string =>
      canonicalStringify(
        positions
          .filter(({ event }) =>
            isAvailableAtDecisionTime(event, decisionTimestampMs)
          )
          .sort(compareReplayPositions)
          .map(({ event }) => event)
      );

    expect(snapshot([current, future])).toBe(snapshot([current]));
  });

  it("rejects non-monotonic replay input", () => {
    const first = position(
      { receivedTimestampMs: 2_000, ingestSequence: 2 },
      2
    );
    const second = position(
      { receivedTimestampMs: 1_000, ingestSequence: 1 },
      1
    );
    expect(() =>
      assertReplayPositionsMonotonic([first, second])
    ).toThrow(/not monotonic/u);
  });
});
