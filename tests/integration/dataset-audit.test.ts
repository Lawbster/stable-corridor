import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { JournalStreamWriter } from "../../src/collector/journal/writer.js";
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
      }
    });
  });
});
