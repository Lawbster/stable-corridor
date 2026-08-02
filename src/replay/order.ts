import type { NormalizedEvent } from "../collector/schema/events.js";

export interface ReplayPosition {
  readonly event: NormalizedEvent;
  readonly journalId: string;
  readonly lineNumber: number;
}

function compareNumber(left: number, right: number): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function compareString(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

export function compareReplayPositions(
  left: ReplayPosition,
  right: ReplayPosition
): number {
  const receiveOrder = compareNumber(
    left.event.receivedTimestampMs,
    right.event.receivedTimestampMs
  );
  if (receiveOrder !== 0) {
    return receiveOrder;
  }

  if (left.event.collectorRunId === right.event.collectorRunId) {
    const ingestOrder = compareNumber(
      left.event.ingestSequence,
      right.event.ingestSequence
    );
    if (ingestOrder !== 0) {
      return ingestOrder;
    }
  } else {
    const runOrder = compareString(
      left.event.collectorRunId,
      right.event.collectorRunId
    );
    if (runOrder !== 0) {
      return runOrder;
    }
  }

  const journalOrder = compareString(left.journalId, right.journalId);
  if (journalOrder !== 0) {
    return journalOrder;
  }

  return compareNumber(left.lineNumber, right.lineNumber);
}

export function isAvailableAtDecisionTime(
  event: NormalizedEvent,
  decisionTimestampMs: number
): boolean {
  return event.receivedTimestampMs <= decisionTimestampMs;
}

export function assertReplayPositionsMonotonic(
  positions: readonly ReplayPosition[]
): void {
  for (let index = 1; index < positions.length; index += 1) {
    const previous = positions[index - 1];
    const current = positions[index];

    if (
      previous !== undefined &&
      current !== undefined &&
      compareReplayPositions(previous, current) > 0
    ) {
      throw new Error(`Replay positions are not monotonic at index ${index}`);
    }
  }
}
