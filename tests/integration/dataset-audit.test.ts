import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { JournalStreamWriter } from "../../src/collector/journal/writer.js";
import {
  compressClosedJournals
} from "../../src/collector/journal/compression.js";
import {
  tradeContinuityEventSchema
} from "../../src/collector/schema/events.js";
import { makeTradeEvent } from "../fixtures/events.js";
import {
  createTestDirectory,
  removeTestDirectory
} from "../fixtures/temp-directory.js";

const execFileAsync = promisify(execFile);
const testDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(testDirectories.splice(0).map(removeTestDirectory));
});

describe("local dataset audit", () => {
  it("verifies a closed journal and writes a reusable report", async () => {
    const root = await createTestDirectory();
    testDirectories.push(root);
    const dataRoot = join(root, "data");
    const reportPath = join(root, "state", "dataset-audit.json");
    const writer = new JournalStreamWriter({
      dataRoot,
      venue: "coinbase",
      product: "EURC-USDC",
      eventType: "trade",
      maxPartBytes: 1024 * 1024,
      syncEveryAppend: true
    });
    await writer.append(
      makeTradeEvent({
        receivedTimestampMs: Date.UTC(2026, 7, 3, 12, 0, 0),
        ingestSequence: 0
      })
    );
    await writer.close();
    await compressClosedJournals({ dataRoot });

    await execFileAsync(process.execPath, [
      resolve("scripts/audit-dataset.mjs"),
      "--data-root",
      dataRoot,
      "--output",
      reportPath,
      "--compression",
      "none"
    ]);
    const report = JSON.parse(await readFile(reportPath, "utf8"));

    expect(report).toMatchObject({
      schemaVersion: 1,
      reportType: "stable_corridor_dataset_audit",
      integrity: {
        passed: true,
        closedParts: 1,
        verifiedClosedParts: 1,
        failures: []
      },
      mutableDataExcluded: {
        openParts: 0,
        openBytes: 0
      },
      total: {
        events: 1,
        eventTypes: { trade: 1 },
        compression: { algorithm: "none" }
      },
      readiness: {
        closedJournalAnalysis: true,
        liveBotCalibration: false
      },
      storedCompression: {
        compressedParts: 1,
        verifiedCompressedParts: 1,
        sourcePresentParts: 1,
        compressedOnlyParts: 0
      }
    });

    const directory = join(
      dataRoot,
      "normalized",
      "2026-08-03",
      "coinbase",
      "EURC-USDC"
    );
    await unlink(join(directory, "trade-000001.jsonl"));
    await execFileAsync(process.execPath, [
      resolve("scripts/audit-dataset.mjs"),
      "--data-root",
      dataRoot,
      "--output",
      reportPath,
      "--compression",
      "none"
    ]);
    const compressedOnlyReport = JSON.parse(
      await readFile(reportPath, "utf8")
    );
    expect(compressedOnlyReport).toMatchObject({
      integrity: {
        passed: true,
        closedParts: 1,
        verifiedClosedParts: 1
      },
      total: { events: 1 },
      storedCompression: {
        verifiedCompressedParts: 1,
        sourcePresentParts: 0,
        compressedOnlyParts: 1
      }
    });
  });

  it("summarizes structured trade-continuity evidence", async () => {
    const root = await createTestDirectory();
    testDirectories.push(root);
    const dataRoot = join(root, "data");
    const reportPath = join(root, "state", "dataset-audit.json");
    const receivedTimestampMs = Date.UTC(2026, 7, 5, 12, 0, 0);
    const writer = new JournalStreamWriter({
      dataRoot,
      venue: "coinbase",
      product: "EURC-USDC",
      eventType: "trade_continuity",
      maxPartBytes: 1024 * 1024,
      syncEveryAppend: true
    });
    await writer.append(
      tradeContinuityEventSchema.parse({
        schemaVersion: 1,
        venue: "coinbase",
        product: "EURC-USDC",
        nativeProduct: "EURC-USDC",
        sourceTimestampMs: receivedTimestampMs - 20,
        receivedTimestampMs,
        ingestSequence: 0,
        collectorRunId: "11111111-1111-4111-8111-111111111111",
        connectionId: "22222222-2222-4222-8222-222222222222",
        venueSequence: "101",
        source: "websocket",
        eventType: "trade_continuity",
        payload: {
          messageType: "update",
          previousTradeId: "100",
          firstObservedTradeId: "99",
          lastObservedTradeId: "104",
          firstAcceptedTradeId: "102",
          lastAcceptedTradeId: "104",
          acceptedTradeCount: 2,
          overlapTradeCount: 1,
          duplicateTradeCount: 1,
          nonAdjacentIdObserved: true,
          observedAtMs: receivedTimestampMs
        }
      })
    );
    await writer.close();

    await execFileAsync(process.execPath, [
      resolve("scripts/audit-dataset.mjs"),
      "--data-root",
      dataRoot,
      "--output",
      reportPath,
      "--compression",
      "none"
    ]);
    const report = JSON.parse(await readFile(reportPath, "utf8"));

    expect(report).toMatchObject({
      integrity: { passed: true },
      tradeContinuity: {
        "coinbase|EURC-USDC|update|non_adjacent=true|overlap=true|duplicate=true": 1
      },
      tradeContinuityTotals: {
        "coinbase|EURC-USDC": {
          messages: 1,
          snapshots: 0,
          updates: 1,
          acceptedTrades: 2,
          overlapTrades: 1,
          duplicateTrades: 1,
          nonAdjacentMessages: 1
        }
      }
    });
  });
});
