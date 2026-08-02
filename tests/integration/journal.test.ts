import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { JournalStreamWriter } from "../../src/collector/journal/writer.js";
import {
  journalDirectory
} from "../../src/collector/journal/path.js";
import { canonicalJsonLine } from "../../src/collector/serialization.js";
import { makeTradeEvent } from "../fixtures/events.js";
import {
  createTestDirectory,
  removeTestDirectory
} from "../fixtures/temp-directory.js";

const testDirectories: string[] = [];
const route = {
  venue: "coinbase",
  product: "EURC-USDC",
  eventType: "trade" as const
};
const receivedTimestampMs = Date.UTC(2026, 7, 2, 12, 0, 0);
const date = "2026-08-02";

afterEach(async () => {
  await Promise.all(testDirectories.splice(0).map(removeTestDirectory));
});

async function newWriter(
  dataRoot: string,
  maxPartBytes = 1024 * 1024
): Promise<JournalStreamWriter> {
  return new JournalStreamWriter({
    dataRoot,
    ...route,
    maxPartBytes,
    syncEveryAppend: true,
    now: () => receivedTimestampMs + 10_000
  });
}

describe("append-only normalized journals", () => {
  it("closes an immutable part with matching checksum metadata", async () => {
    const dataRoot = await createTestDirectory();
    testDirectories.push(dataRoot);
    const writer = await newWriter(dataRoot);
    const event = makeTradeEvent({ receivedTimestampMs });

    await writer.append(event);
    await writer.close();

    const directory = journalDirectory(dataRoot, date, route);
    const journalPath = join(directory, "trade-000001.jsonl");
    const metadataPath = `${journalPath}.meta.json`;
    const journalContents = await readFile(journalPath, "utf8");
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));

    expect(journalContents).toBe(canonicalJsonLine(event));
    expect(metadata.eventCount).toBe(1);
    expect(metadata.bytes).toBe(Buffer.byteLength(journalContents));
    expect(metadata.compressionEligible).toBe(true);
    expect(metadata.sha256).toBe(
      createHash("sha256").update(journalContents).digest("hex")
    );
    expect(await readdir(directory)).toEqual([
      "trade-000001.jsonl",
      "trade-000001.jsonl.meta.json"
    ]);
  });

  it("rotates before a new record would exceed the part limit", async () => {
    const dataRoot = await createTestDirectory();
    testDirectories.push(dataRoot);
    const writer = await newWriter(dataRoot, 1);

    await writer.append(
      makeTradeEvent({ receivedTimestampMs, ingestSequence: 1 })
    );
    await writer.append(
      makeTradeEvent({
        receivedTimestampMs: receivedTimestampMs + 1,
        ingestSequence: 2
      })
    );
    await writer.close();

    const directory = journalDirectory(dataRoot, date, route);
    const journalFiles = (await readdir(directory)).filter((file) =>
      file.endsWith(".jsonl")
    );
    expect(journalFiles).toEqual([
      "trade-000001.jsonl",
      "trade-000002.jsonl"
    ]);
  });

  it("rotates on UTC day boundaries", async () => {
    const dataRoot = await createTestDirectory();
    testDirectories.push(dataRoot);
    const writer = await newWriter(dataRoot);
    const nextDayTimestampMs = Date.UTC(2026, 7, 3, 0, 0, 0);

    await writer.append(
      makeTradeEvent({ receivedTimestampMs, ingestSequence: 1 })
    );
    await writer.append(
      makeTradeEvent({
        receivedTimestampMs: nextDayTimestampMs,
        ingestSequence: 2
      })
    );
    await writer.close();

    expect(
      await readFile(
        join(
          journalDirectory(dataRoot, "2026-08-02", route),
          "trade-000001.jsonl"
        ),
        "utf8"
      )
    ).toContain('"ingestSequence":1');
    expect(
      await readFile(
        join(
          journalDirectory(dataRoot, "2026-08-03", route),
          "trade-000001.jsonl"
        ),
        "utf8"
      )
    ).toContain('"ingestSequence":2');
  });

  it("truncates a crash-partial line and starts a new immutable part", async () => {
    const dataRoot = await createTestDirectory();
    testDirectories.push(dataRoot);
    const directory = journalDirectory(dataRoot, date, route);
    await mkdir(directory, { recursive: true });
    const firstEvent = makeTradeEvent({
      receivedTimestampMs,
      ingestSequence: 1
    });
    await writeFile(
      join(directory, "trade-000001.jsonl.open"),
      `${canonicalJsonLine(firstEvent)}{"partial":`,
      "utf8"
    );

    const writer = await newWriter(dataRoot);
    const secondEvent = makeTradeEvent({
      receivedTimestampMs: receivedTimestampMs + 1,
      ingestSequence: 2
    });
    await writer.append(secondEvent);
    await writer.close();

    expect(
      await readFile(join(directory, "trade-000001.jsonl"), "utf8")
    ).toBe(canonicalJsonLine(firstEvent));
    expect(
      await readFile(join(directory, "trade-000002.jsonl"), "utf8")
    ).toBe(canonicalJsonLine(secondEvent));
  });

  it("fails closed on a route mismatch", async () => {
    const dataRoot = await createTestDirectory();
    testDirectories.push(dataRoot);
    const writer = await newWriter(dataRoot);

    await expect(
      writer.append(
        makeTradeEvent({
          venue: "binance",
          receivedTimestampMs
        })
      )
    ).rejects.toThrow(/does not match writer route/u);
    await expect(writer.close()).rejects.toThrow(
      /does not match writer route/u
    );
  });

  it("rejects unsafe route segments before touching the filesystem", async () => {
    const dataRoot = await createTestDirectory();
    testDirectories.push(dataRoot);

    expect(
      () =>
        new JournalStreamWriter({
          dataRoot,
          venue: "coinbase",
          product: "../escape",
          eventType: "trade",
          maxPartBytes: 1024,
          syncEveryAppend: true
        })
    ).toThrow(/Unsafe product/u);
  });
});
