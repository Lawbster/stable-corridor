import {
  readFile,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  compressClosedJournals
} from "../../src/collector/journal/compression.js";
import { journalDirectory } from "../../src/collector/journal/path.js";
import { JournalStreamWriter } from "../../src/collector/journal/writer.js";
import {
  feedStatusEventSchema
} from "../../src/collector/schema/events.js";
import {
  discoverClosedJournalParts,
  readMergedJournalParts
} from "../../src/replay/journal-reader.js";
import {
  makeBookCheckpointEvent
} from "../fixtures/events.js";
import {
  createTestDirectory,
  removeTestDirectory
} from "../fixtures/temp-directory.js";

const testDirectories: string[] = [];
const receivedTimestampMs = Date.UTC(2026, 7, 5, 12, 0, 0);

afterEach(async () => {
  await Promise.all(testDirectories.splice(0).map(removeTestDirectory));
});

async function writeCheckpoint(
  dataRoot: string,
  options: {
    readonly venue: string;
    readonly product: string;
    readonly receivedTimestampMs: number;
    readonly ingestSequence: number;
  }
): Promise<string> {
  const writer = new JournalStreamWriter({
    dataRoot,
    venue: options.venue,
    product: options.product,
    eventType: "book_checkpoint",
    maxPartBytes: 1024 * 1024,
    syncEveryAppend: true,
    now: () => options.receivedTimestampMs + 1_000
  });
  await writer.append(makeBookCheckpointEvent(options));
  await writer.close();
  return join(
    journalDirectory(dataRoot, "2026-08-05", {
      venue: options.venue,
      product: options.product,
      eventType: "book_checkpoint"
    }),
    "book_checkpoint-000001.jsonl"
  );
}

async function collect(
  dataRoot: string,
  preferRepresentation: "source" | "gzip" = "gzip",
  collectorRunId?: string
) {
  const parts = await discoverClosedJournalParts({
    dataRoot,
    eventTypes: new Set(["book_checkpoint"]),
    preferRepresentation
  });
  const positions = [];
  for await (const position of readMergedJournalParts(
    parts,
    collectorRunId === undefined ? {} : { collectorRunId }
  )) {
    positions.push(position);
  }
  return { parts, positions };
}

describe("unified replay journal reader", () => {
  it("selects one gzip representation and supports gzip-only storage", async () => {
    const dataRoot = await createTestDirectory();
    testDirectories.push(dataRoot);
    const sourcePath = await writeCheckpoint(dataRoot, {
      venue: "coinbase",
      product: "EURC-USDC",
      receivedTimestampMs,
      ingestSequence: 1
    });
    await compressClosedJournals({ dataRoot });

    const withSource = await collect(dataRoot);
    expect(withSource.parts).toHaveLength(1);
    expect(withSource.parts[0]?.representation).toBe("gzip");
    expect(withSource.positions).toHaveLength(1);
    expect(withSource.positions[0]?.event.product).toBe("EURC-USDC");

    await unlink(sourcePath);
    const gzipOnly = await collect(dataRoot);
    expect(gzipOnly.parts[0]?.representation).toBe("gzip");
    expect(gzipOnly.parts[0]).not.toHaveProperty("sourcePath");
    expect(gzipOnly.positions).toHaveLength(1);
  });

  it("rejects compressed bytes that do not match immutable metadata", async () => {
    const dataRoot = await createTestDirectory();
    testDirectories.push(dataRoot);
    const sourcePath = await writeCheckpoint(dataRoot, {
      venue: "coinbase",
      product: "EURC-USDC",
      receivedTimestampMs,
      ingestSequence: 1
    });
    await compressClosedJournals({ dataRoot });
    await writeFile(`${sourcePath}.gz`, "not gzip");

    await expect(collect(dataRoot)).rejects.toThrow();
    expect((await stat(sourcePath)).isFile()).toBe(true);
  });

  it("merges route series by receive time without double counting", async () => {
    const dataRoot = await createTestDirectory();
    testDirectories.push(dataRoot);
    await writeCheckpoint(dataRoot, {
      venue: "coinbase",
      product: "EURC-USDC",
      receivedTimestampMs: receivedTimestampMs + 2,
      ingestSequence: 2
    });
    await writeCheckpoint(dataRoot, {
      venue: "binance",
      product: "EUR-USDC",
      receivedTimestampMs: receivedTimestampMs + 1,
      ingestSequence: 1
    });
    await compressClosedJournals({ dataRoot });

    const { parts, positions } = await collect(dataRoot);
    expect(parts).toHaveLength(2);
    expect(positions.map(({ event }) => event.venue)).toEqual([
      "binance",
      "coinbase"
    ]);
    expect(
      positions.map(({ event }) => event.ingestSequence)
    ).toEqual([1, 2]);
  });

  it("can explicitly select a verified source representation", async () => {
    const dataRoot = await createTestDirectory();
    testDirectories.push(dataRoot);
    const sourcePath = await writeCheckpoint(dataRoot, {
      venue: "coinbase",
      product: "EURC-USDC",
      receivedTimestampMs,
      ingestSequence: 1
    });
    await compressClosedJournals({ dataRoot });
    const sourceContents = await readFile(sourcePath);

    const result = await collect(dataRoot, "source");
    expect(result.parts[0]?.representation).toBe("source");
    expect(result.positions).toHaveLength(1);
    expect(await readFile(sourcePath)).toEqual(sourceContents);
  });

  it("excludes unrelated runs before enforcing receive order", async () => {
    const dataRoot = await createTestDirectory();
    testDirectories.push(dataRoot);
    const selectedRunId = "33333333-3333-4333-8333-333333333333";
    const writer = new JournalStreamWriter({
      dataRoot,
      venue: "coinbase",
      product: "EURC-USDC",
      eventType: "book_checkpoint",
      maxPartBytes: 1024 * 1024,
      syncEveryAppend: true,
      now: () => receivedTimestampMs + 10_000
    });
    await writer.append(
      makeBookCheckpointEvent({
        receivedTimestampMs: receivedTimestampMs + 200,
        ingestSequence: 1
      })
    );
    await writer.append(
      makeBookCheckpointEvent({
        receivedTimestampMs: receivedTimestampMs + 100,
        ingestSequence: 2
      })
    );
    await writer.append(
      makeBookCheckpointEvent({
        receivedTimestampMs: receivedTimestampMs + 300,
        ingestSequence: 3,
        collectorRunId: selectedRunId
      })
    );
    await writer.close();
    await compressClosedJournals({ dataRoot });

    await expect(collect(dataRoot)).rejects.toThrow(
      /Receive time moved backwards/u
    );
    const selected = await collect(dataRoot, "gzip", selectedRunId);
    expect(selected.positions).toHaveLength(1);
    expect(selected.positions[0]?.event.collectorRunId).toBe(
      selectedRunId
    );
  });

  it("receive-time sorts the bounded feed-status series", async () => {
    const dataRoot = await createTestDirectory();
    testDirectories.push(dataRoot);
    const collectorRunId = "33333333-3333-4333-8333-333333333333";
    const connectionId = "44444444-4444-4444-8444-444444444444";
    const writer = new JournalStreamWriter({
      dataRoot,
      venue: "coinbase",
      product: "EURC-USDC",
      eventType: "feed_status",
      maxPartBytes: 1024 * 1024,
      syncEveryAppend: true,
      now: () => receivedTimestampMs + 10_000
    });
    for (const [offset, ingestSequence, state] of [
      [200, 1, "stale"],
      [100, 2, "healthy"]
    ] as const) {
      await writer.append(
        feedStatusEventSchema.parse({
          schemaVersion: 1,
          venue: "coinbase",
          product: "EURC-USDC",
          nativeProduct: "EURC-USDC",
          sourceTimestampMs: null,
          receivedTimestampMs: receivedTimestampMs + offset,
          ingestSequence,
          collectorRunId,
          connectionId,
          venueSequence: null,
          source: "websocket",
          eventType: "feed_status",
          payload: {
            state,
            eligibleForResearch: state === "healthy",
            reason: state === "healthy" ? null : "no_message_for_100ms",
            lastGoodVenueSequence: null,
            observedAtMs: receivedTimestampMs + offset
          }
        })
      );
    }
    await writer.close();
    await compressClosedJournals({ dataRoot });
    const parts = await discoverClosedJournalParts({
      dataRoot,
      eventTypes: new Set(["feed_status"]),
      preferRepresentation: "gzip"
    });
    const positions = [];
    for await (const position of readMergedJournalParts(parts, {
      collectorRunId
    })) {
      positions.push(position);
    }

    expect(
      positions.map(({ event }) => event.receivedTimestampMs)
    ).toEqual([
      receivedTimestampMs + 100,
      receivedTimestampMs + 200
    ]);
  });
});
