import { gunzipSync } from "node:zlib";
import {
  appendFile,
  readFile,
  readdir,
  unlink,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  compressClosedJournals,
  journalCompressionMetadataSchema
} from "../../src/collector/journal/compression.js";
import {
  journalDirectory
} from "../../src/collector/journal/path.js";
import { JournalStreamWriter } from "../../src/collector/journal/writer.js";
import { makeTradeEvent } from "../fixtures/events.js";
import {
  createTestDirectory,
  removeTestDirectory
} from "../fixtures/temp-directory.js";

const testDirectories: string[] = [];
const receivedTimestampMs = Date.UTC(2026, 7, 5, 12, 0, 0);
const route = {
  venue: "coinbase",
  product: "EURC-USDC",
  eventType: "trade" as const
};

afterEach(async () => {
  await Promise.all(testDirectories.splice(0).map(removeTestDirectory));
});

async function writeOnePart(dataRoot: string): Promise<string> {
  const writer = new JournalStreamWriter({
    dataRoot,
    ...route,
    maxPartBytes: 1024 * 1024,
    syncEveryAppend: true,
    now: () => receivedTimestampMs + 1_000
  });
  await writer.append(
    makeTradeEvent({ receivedTimestampMs, ingestSequence: 0 })
  );
  await writer.close();
  return join(
    journalDirectory(dataRoot, "2026-08-05", route),
    "trade-000001.jsonl"
  );
}

describe("closed journal compression", () => {
  it("publishes verified gzip data without changing its source", async () => {
    const dataRoot = await createTestDirectory();
    testDirectories.push(dataRoot);
    const sourcePath = await writeOnePart(dataRoot);
    const source = await readFile(sourcePath);

    const first = await compressClosedJournals({
      dataRoot,
      now: () => receivedTimestampMs + 2_000
    });
    expect(first).toMatchObject({
      eligibleParts: 1,
      compressedParts: 1,
      verifiedExistingParts: 0,
      sourceBytes: source.length
    });
    expect(gunzipSync(await readFile(`${sourcePath}.gz`))).toEqual(source);
    const metadata = journalCompressionMetadataSchema.parse(
      JSON.parse(await readFile(`${sourcePath}.gz.meta.json`, "utf8"))
    );
    expect(metadata).toMatchObject({
      recordType: "journal_compression",
      sourceFileName: "trade-000001.jsonl",
      compressedFileName: "trade-000001.jsonl.gz",
      sourceBytes: source.length,
      sourceSha256:
        JSON.parse(await readFile(`${sourcePath}.meta.json`, "utf8"))
          .sha256
    });

    const second = await compressClosedJournals({ dataRoot });
    expect(second).toMatchObject({
      eligibleParts: 1,
      compressedParts: 0,
      verifiedExistingParts: 1
    });
    expect(await readFile(sourcePath)).toEqual(source);
  });

  it("fails without publishing when source metadata no longer matches", async () => {
    const dataRoot = await createTestDirectory();
    testDirectories.push(dataRoot);
    const sourcePath = await writeOnePart(dataRoot);
    await appendFile(sourcePath, "{}\n");

    await expect(
      compressClosedJournals({ dataRoot })
    ).rejects.toThrow(/Source byte count mismatch/u);
    await expect(readFile(`${sourcePath}.gz`)).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("rejects compression metadata that predates source finalization", async () => {
    const dataRoot = await createTestDirectory();
    testDirectories.push(dataRoot);
    const sourcePath = await writeOnePart(dataRoot);
    await compressClosedJournals({ dataRoot });
    const sourceMetadata = JSON.parse(
      await readFile(`${sourcePath}.meta.json`, "utf8")
    );
    const compressionMetadataPath = `${sourcePath}.gz.meta.json`;
    const compressionMetadata = JSON.parse(
      await readFile(compressionMetadataPath, "utf8")
    );
    await writeFile(
      compressionMetadataPath,
      `${JSON.stringify({
        ...compressionMetadata,
        createdAtMs: sourceMetadata.finalizedAtMs - 1
      })}\n`
    );

    await expect(
      compressClosedJournals({ dataRoot })
    ).rejects.toThrow(/predates source finalization/u);
  });

  it("prioritizes an uncompressed part in each bounded trial", async () => {
    const dataRoot = await createTestDirectory();
    testDirectories.push(dataRoot);
    await writeOnePart(dataRoot);
    await writeOnePart(dataRoot);

    const first = await compressClosedJournals({
      dataRoot,
      maxParts: 1
    });
    const second = await compressClosedJournals({
      dataRoot,
      maxParts: 1
    });

    expect(first).toMatchObject({
      eligibleParts: 2,
      compressedParts: 1,
      verifiedExistingParts: 0
    });
    expect(second).toMatchObject({
      eligibleParts: 2,
      compressedParts: 1,
      verifiedExistingParts: 0
    });
  });

  it("never reuses a part represented only by verified gzip data", async () => {
    const dataRoot = await createTestDirectory();
    testDirectories.push(dataRoot);
    const sourcePath = await writeOnePart(dataRoot);
    await compressClosedJournals({ dataRoot });
    await unlink(sourcePath);

    const writer = new JournalStreamWriter({
      dataRoot,
      ...route,
      maxPartBytes: 1024 * 1024,
      syncEveryAppend: true
    });
    await writer.append(
      makeTradeEvent({
        receivedTimestampMs: receivedTimestampMs + 1,
        ingestSequence: 1
      })
    );
    await writer.close();

    expect(
      await readdir(journalDirectory(dataRoot, "2026-08-05", route))
    ).toEqual(
      expect.arrayContaining([
        "trade-000001.jsonl.gz",
        "trade-000001.jsonl.gz.meta.json",
        "trade-000001.jsonl.meta.json",
        "trade-000002.jsonl",
        "trade-000002.jsonl.meta.json"
      ])
    );
  });
});
