import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { JournalStreamWriter } from "../../src/collector/journal/writer.js";
import type {
  NormalizedEvent,
  NormalizedEventType
} from "../../src/collector/schema/events.js";
import { KrakenPublicAdapter } from "../../src/venues/kraken/adapter.js";
import {
  krakenAssetPairs,
  krakenBookSnapshotRaw,
  krakenBookSubscriptionAck,
  krakenBookUpdateRaw,
  krakenStatus,
  krakenTradeRaw,
  krakenTradeSubscriptionAck
} from "../fixtures/kraken.js";
import {
  createTestDirectory,
  removeTestDirectory
} from "../fixtures/temp-directory.js";

const testDirectories: string[] = [];
const collectorRunId = "11111111-1111-4111-8111-111111111111";
const connectionId = "22222222-2222-4222-8222-222222222222";
const receivedBase = Date.parse("2026-08-02T14:19:20Z");

afterEach(async () => {
  await Promise.all(testDirectories.splice(0).map(removeTestDirectory));
});

async function collectFiles(
  root: string,
  current = root
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) {
      for (const [name, contents] of await collectFiles(root, path)) {
        files.set(name, contents);
      }
    } else if (entry.isFile()) {
      files.set(
        relative(root, path).split(sep).join("/"),
        await readFile(path, "utf8")
      );
    }
  }
  return files;
}

function recordedEvents(): readonly NormalizedEvent[] {
  const adapter = new KrakenPublicAdapter({
    products: ["USDC/USD"],
    collectorRunId,
    depth: 25,
    maxRecentTradeIds: 100,
    staleAfterMs: 60_000
  });
  return [
    ...adapter.beginConnection(connectionId, receivedBase),
    ...adapter.ingestAssetPairs(krakenAssetPairs, receivedBase + 1),
    ...adapter.ingest(krakenStatus, receivedBase + 2),
    ...adapter.ingest(krakenBookSubscriptionAck, receivedBase + 3),
    ...adapter.ingest(krakenTradeSubscriptionAck, receivedBase + 4),
    ...adapter.ingest(krakenBookSnapshotRaw, receivedBase + 5),
    ...adapter.ingest(krakenBookUpdateRaw, receivedBase + 6),
    ...adapter.ingest(krakenTradeRaw, receivedBase + 7)
  ];
}

async function journalRecordedEvents(dataRoot: string): Promise<void> {
  const writers = new Map<NormalizedEventType, JournalStreamWriter>();
  for (const event of recordedEvents()) {
    let writer = writers.get(event.eventType);
    if (writer === undefined) {
      writer = new JournalStreamWriter({
        dataRoot,
        venue: event.venue,
        product: event.product,
        eventType: event.eventType,
        maxPartBytes: 1024 * 1024,
        syncEveryAppend: true,
        now: () => receivedBase + 10_000
      });
      writers.set(event.eventType, writer);
    }
    await writer.append(event);
  }
  await Promise.all(
    [...writers.values()].map(async (writer) => writer.close())
  );
}

describe("Kraken recorded public stream journaling", () => {
  it("produces byte-identical normalized journals and metadata", async () => {
    const firstRoot = await createTestDirectory();
    const secondRoot = await createTestDirectory();
    testDirectories.push(firstRoot, secondRoot);
    await journalRecordedEvents(firstRoot);
    await journalRecordedEvents(secondRoot);
    const first = await collectFiles(firstRoot);
    const second = await collectFiles(secondRoot);
    expect(first).toEqual(second);
    expect([...first.keys()]).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/instrument-000001\.jsonl$/u),
        expect.stringMatching(/book_checkpoint-000001\.jsonl$/u),
        expect.stringMatching(/book_delta-000001\.jsonl$/u),
        expect.stringMatching(/trade-000001\.jsonl$/u),
        expect.stringMatching(/market_status-000001\.jsonl$/u),
        expect.stringMatching(/feed_status-000001\.jsonl$/u)
      ])
    );
  });
});
