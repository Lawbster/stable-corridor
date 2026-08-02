import type { CollectorHealth } from "../../src/health/schema.js";

export function makeCollectorHealth(
  publishedAtMs = 1_700_000_000_500
): CollectorHealth {
  return {
    schemaVersion: 1,
    processName: "stable-corridor-collector",
    status: "healthy",
    reasonCodes: [],
    commitSha: null,
    configHash: "fixture-config-hash",
    startedAtMs: 1_700_000_000_000,
    publishedAtMs,
    eventLoopLagMs: 1.5,
    memoryRssBytes: 64 * 1024 * 1024,
    dataRootBytes: 1024,
    diskFreeBytes: 100 * 1024 * 1024,
    journalLastWriteAtMs: 1_700_000_000_450,
    journalErrorCount: 0,
    feeds: [
      {
        venue: "coinbase",
        product: "EURC-USDC",
        connectionState: "healthy",
        lastReceivedAtMs: 1_700_000_000_450,
        lastSourceAtMs: 1_700_000_000_440,
        receiveAgeMs: 50,
        venueSequence: "100",
        gapCount: 0,
        reconnectCount: 0,
        crossedBookCount: 0,
        eligibleForResearch: true
      }
    ]
  };
}
