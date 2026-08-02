import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { journalDirectory } from "../../src/collector/journal/path.js";
import {
  CollectorEventSink,
  type FeedDiagnostic
} from "../../src/collector/runtime/event-sink.js";
import { makeTradeEvent } from "../fixtures/events.js";
import {
  createTestDirectory,
  removeTestDirectory
} from "../fixtures/temp-directory.js";

const testDirectories: string[] = [];
const receivedTimestampMs = Date.UTC(2026, 7, 2, 12, 0, 0);

afterEach(async () => {
  await Promise.all(testDirectories.splice(0).map(removeTestDirectory));
});

describe("collector event sink", () => {
  it("assigns one global ingest sequence across venue journals", async () => {
    const dataRoot = await createTestDirectory();
    testDirectories.push(dataRoot);
    const sink = new CollectorEventSink({
      dataRoot,
      maxPartBytes: 1024 * 1024,
      syncEveryAppend: true
    });

    await Promise.all([
      sink.append([
        makeTradeEvent({
          venue: "coinbase",
          product: "EURC-USDC",
          ingestSequence: 91,
          receivedTimestampMs
        })
      ]),
      sink.append([
        makeTradeEvent({
          venue: "bybit",
          product: "USDC-USDT",
          ingestSequence: 7,
          receivedTimestampMs: receivedTimestampMs + 1
        })
      ])
    ]);
    await sink.close();

    const coinbase = JSON.parse(
      (
        await readFile(
          join(
            journalDirectory(dataRoot, "2026-08-02", {
              venue: "coinbase",
              product: "EURC-USDC",
              eventType: "trade"
            }),
            "trade-000001.jsonl"
          ),
          "utf8"
        )
      ).trim()
    ) as { ingestSequence: number };
    const bybit = JSON.parse(
      (
        await readFile(
          join(
            journalDirectory(dataRoot, "2026-08-02", {
              venue: "bybit",
              product: "USDC-USDT",
              eventType: "trade"
            }),
            "trade-000001.jsonl"
          ),
          "utf8"
        )
      ).trim()
    ) as { ingestSequence: number };

    expect(coinbase.ingestSequence).toBe(0);
    expect(bybit.ingestSequence).toBe(1);
    expect(sink.journalLastWriteAtMs).toBe(receivedTimestampMs + 1);
  });

  it("combines journal observations with adapter diagnostics", async () => {
    const dataRoot = await createTestDirectory();
    testDirectories.push(dataRoot);
    const sink = new CollectorEventSink({
      dataRoot,
      maxPartBytes: 1024 * 1024,
      syncEveryAppend: false
    });
    await sink.append([
      makeTradeEvent({
        receivedTimestampMs,
        sourceTimestampMs: receivedTimestampMs - 5,
        venueSequence: "123"
      })
    ]);
    const diagnostic: FeedDiagnostic = {
      venue: "coinbase",
      product: "EURC-USDC",
      connectionState: "healthy",
      venueSequence: "124",
      gapCount: 0,
      reconnectCount: 1,
      crossedBookCount: 0,
      eligibleForResearch: true
    };

    expect(
      sink.feedHealth([diagnostic], receivedTimestampMs + 25)
    ).toEqual([
      {
        venue: "coinbase",
        product: "EURC-USDC",
        connectionState: "healthy",
        lastReceivedAtMs: receivedTimestampMs,
        lastSourceAtMs: receivedTimestampMs - 5,
        receiveAgeMs: 25,
        venueSequence: "124",
        gapCount: 0,
        reconnectCount: 1,
        crossedBookCount: 0,
        eligibleForResearch: true
      }
    ]);
    await sink.close();
  });
});
