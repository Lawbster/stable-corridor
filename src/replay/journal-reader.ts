import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  readFile,
  readdir
} from "node:fs/promises";
import {
  basename,
  join,
  relative,
  sep
} from "node:path";
import { createInterface } from "node:readline";
import { PassThrough, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

import {
  journalCompressionMetadataSchema,
  type JournalCompressionMetadata
} from "../collector/journal/compression.js";
import {
  journalPartMetadataSchema,
  type JournalPartMetadata
} from "../collector/journal/metadata.js";
import { resolveContainedPath } from "../collector/journal/path.js";
import {
  parseNormalizedEvent,
  type NormalizedEventType
} from "../collector/schema/events.js";
import {
  compareReplayPositions,
  type ReplayPosition
} from "./order.js";

export type JournalRepresentation = "source" | "gzip";

export interface ClosedJournalPart {
  readonly journalId: string;
  readonly relativePath: string;
  readonly sourcePath?: string;
  readonly compressedPath?: string;
  readonly metadataPath: string;
  readonly compressionMetadataPath?: string;
  readonly representation: JournalRepresentation;
  readonly readPath: string;
  readonly metadata: JournalPartMetadata;
  readonly compressionMetadata?: JournalCompressionMetadata;
}

export interface DiscoverClosedJournalPartsOptions {
  readonly dataRoot: string;
  readonly eventTypes?: ReadonlySet<NormalizedEventType>;
  readonly preferRepresentation?: JournalRepresentation;
}

export interface ReadJournalOptions {
  readonly collectorRunId?: string;
}

interface StreamObservation {
  bytes: number;
  readonly hash: ReturnType<typeof createHash>;
}

interface HeapEntry {
  readonly position: ReplayPosition;
  readonly iterator: AsyncIterator<ReplayPosition>;
}

const journalPathPattern =
  /^normalized\/(\d{4}-\d{2}-\d{2})\/([^/]+)\/([^/]+)\/([a-z_]+)-(\d{6})\.jsonl$/u;

function errorCode(error: unknown): string | undefined {
  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return undefined;
}

async function assertRegularFile(filePath: string): Promise<void> {
  const information = await lstat(filePath);
  if (information.isSymbolicLink() || !information.isFile()) {
    throw new Error(`Expected a regular file: ${filePath}`);
  }
}

async function regularFileExists(filePath: string): Promise<boolean> {
  try {
    await assertRegularFile(filePath);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function walkFiles(root: string): Promise<string[]> {
  const information = await lstat(root);
  if (information.isSymbolicLink() || !information.isDirectory()) {
    throw new Error(`Invalid journal directory: ${root}`);
  }

  const output: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      output.push(...(await walkFiles(path)));
    } else if (entry.isFile()) {
      output.push(path);
    } else if (entry.isSymbolicLink()) {
      throw new Error(`Symbolic links are not supported: ${path}`);
    }
  }
  return output;
}

function normalizedRelativePath(root: string, path: string): string {
  const output = relative(root, path).split(sep).join("/");
  if (
    output.length === 0 ||
    output.startsWith("/") ||
    output.includes("\\") ||
    output.split("/").some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".."
    )
  ) {
    throw new Error(`Invalid journal relative path: ${output}`);
  }
  return output;
}

function assertEqual(
  actual: string | number,
  expected: string | number,
  label: string,
  path: string
): void {
  if (actual !== expected) {
    throw new Error(
      `${label} mismatch for ${path}: ` +
        `expected=${expected} actual=${actual}`
    );
  }
}

function hashContents(contents: Uint8Array): string {
  return createHash("sha256").update(contents).digest("hex");
}

async function describePart(
  dataRoot: string,
  relativePath: string,
  preferRepresentation: JournalRepresentation
): Promise<ClosedJournalPart | undefined> {
  const match = journalPathPattern.exec(relativePath);
  if (match === null) {
    throw new Error(`Invalid normalized journal path: ${relativePath}`);
  }
  const [
    ,
    expectedDate,
    expectedVenue,
    expectedProduct,
    expectedEventType,
    expectedPart
  ] = match;
  const sourcePath = resolveContainedPath(
    dataRoot,
    ...relativePath.split("/")
  );
  const compressedPath = `${sourcePath}.gz`;
  const metadataPath = `${sourcePath}.meta.json`;
  const compressionMetadataPath = `${compressedPath}.meta.json`;
  const sourcePresent = await regularFileExists(sourcePath);
  const compressedPresent = await regularFileExists(compressedPath);
  if (!sourcePresent && !compressedPresent) {
    return undefined;
  }

  await assertRegularFile(metadataPath);
  const metadataContents = await readFile(metadataPath);
  const metadata = journalPartMetadataSchema.parse(
    JSON.parse(metadataContents.toString("utf8"))
  );
  assertEqual(
    metadata.date,
    expectedDate!,
    "Journal date",
    relativePath
  );
  assertEqual(
    metadata.venue,
    expectedVenue!,
    "Journal venue",
    relativePath
  );
  assertEqual(
    metadata.product,
    expectedProduct!,
    "Journal product",
    relativePath
  );
  assertEqual(
    metadata.eventType,
    expectedEventType!,
    "Journal event type",
    relativePath
  );
  assertEqual(
    metadata.part,
    Number.parseInt(expectedPart!, 10),
    "Journal part",
    relativePath
  );
  assertEqual(
    metadata.fileName,
    basename(sourcePath),
    "Journal filename",
    relativePath
  );

  let compressionMetadata: JournalCompressionMetadata | undefined;
  if (compressedPresent) {
    await assertRegularFile(compressionMetadataPath);
    const compressionMetadataContents = await readFile(
      compressionMetadataPath
    );
    compressionMetadata = journalCompressionMetadataSchema.parse(
      JSON.parse(compressionMetadataContents.toString("utf8"))
    );
    assertEqual(
      compressionMetadata.sourceFileName,
      basename(sourcePath),
      "Compression source filename",
      relativePath
    );
    assertEqual(
      compressionMetadata.sourceMetadataFileName,
      basename(metadataPath),
      "Compression source metadata filename",
      relativePath
    );
    assertEqual(
      compressionMetadata.compressedFileName,
      basename(compressedPath),
      "Compression filename",
      relativePath
    );
    assertEqual(
      compressionMetadata.sourceBytes,
      metadata.bytes,
      "Compression source bytes",
      relativePath
    );
    assertEqual(
      compressionMetadata.sourceSha256,
      metadata.sha256,
      "Compression source SHA-256",
      relativePath
    );
    assertEqual(
      compressionMetadata.sourceMetadataSha256,
      hashContents(metadataContents),
      "Compression source metadata SHA-256",
      relativePath
    );
    if (compressionMetadata.createdAtMs < metadata.finalizedAtMs) {
      throw new Error(
        `Compression predates source finalization: ${relativePath}`
      );
    }
  }

  const representation =
    preferRepresentation === "gzip" && compressedPresent
      ? "gzip"
      : preferRepresentation === "source" && sourcePresent
        ? "source"
        : compressedPresent
          ? "gzip"
          : "source";
  return {
    journalId: relativePath,
    relativePath,
    ...(sourcePresent ? { sourcePath } : {}),
    ...(compressedPresent ? { compressedPath } : {}),
    metadataPath,
    ...(compressedPresent ? { compressionMetadataPath } : {}),
    representation,
    readPath:
      representation === "gzip" ? compressedPath : sourcePath,
    metadata,
    ...(compressionMetadata === undefined
      ? {}
      : { compressionMetadata })
  };
}

export async function discoverClosedJournalParts(
  options: DiscoverClosedJournalPartsOptions
): Promise<ClosedJournalPart[]> {
  const dataRoot = resolveContainedPath(options.dataRoot);
  const normalizedRoot = resolveContainedPath(dataRoot, "normalized");
  const preferRepresentation = options.preferRepresentation ?? "gzip";
  const logicalPaths = new Set<string>();
  for (const path of await walkFiles(normalizedRoot)) {
    const relativePath = normalizedRelativePath(dataRoot, path);
    if (relativePath.endsWith(".jsonl")) {
      logicalPaths.add(relativePath);
    } else if (relativePath.endsWith(".jsonl.gz")) {
      logicalPaths.add(relativePath.slice(0, -".gz".length));
    }
  }

  const output: ClosedJournalPart[] = [];
  for (const relativePath of [...logicalPaths].sort()) {
    const match = journalPathPattern.exec(relativePath);
    if (match === null) {
      throw new Error(`Invalid normalized journal path: ${relativePath}`);
    }
    const eventType = match[4] as NormalizedEventType;
    if (
      options.eventTypes !== undefined &&
      !options.eventTypes.has(eventType)
    ) {
      continue;
    }
    const part = await describePart(
      dataRoot,
      relativePath,
      preferRepresentation
    );
    if (part !== undefined) {
      output.push(part);
    }
  }
  return output;
}

function observationTransform(
  observation: StreamObservation
): Transform {
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      observation.bytes += chunk.length;
      observation.hash.update(chunk);
      callback(null, chunk);
    }
  });
}

async function* readClosedJournalPartInternal(
  part: ClosedJournalPart,
  options: ReadJournalOptions,
  enforceReceiveOrder: boolean
): AsyncGenerator<ReplayPosition> {
  await assertRegularFile(part.readPath);
  const sourceObservation: StreamObservation = {
    bytes: 0,
    hash: createHash("sha256")
  };
  const raw = createReadStream(part.readPath);
  let compressedObservation: StreamObservation | undefined;
  const decoded = new PassThrough();
  let pump: Promise<void>;
  if (part.representation === "gzip") {
    compressedObservation = {
      bytes: 0,
      hash: createHash("sha256")
    };
    pump = pipeline(
      raw,
      observationTransform(compressedObservation),
      createGunzip(),
      observationTransform(sourceObservation),
      decoded
    );
  } else {
    pump = pipeline(
      raw,
      observationTransform(sourceObservation),
      decoded
    );
  }
  void pump.catch(() => undefined);

  const lines = createInterface({
    input: decoded,
    crlfDelay: Number.POSITIVE_INFINITY
  });
  let lineNumber = 0;
  let firstReceivedTimestampMs: number | undefined;
  let lastReceivedTimestampMs: number | undefined;
  let lastSelectedReceivedTimestampMs: number | undefined;
  let completed = false;
  let streamError: unknown;
  try {
    for await (const line of lines) {
      lineNumber += 1;
      if (line.length === 0) {
        throw new Error(
          `Empty line ${lineNumber} in ${part.relativePath}`
        );
      }
      const event = parseNormalizedEvent(JSON.parse(line));
      if (
        event.venue !== part.metadata.venue ||
        event.product !== part.metadata.product ||
        event.eventType !== part.metadata.eventType
      ) {
        throw new Error(
          `Event route mismatch at ${part.relativePath}:${lineNumber}`
        );
      }
      firstReceivedTimestampMs ??= event.receivedTimestampMs;
      lastReceivedTimestampMs = event.receivedTimestampMs;
      if (
        options.collectorRunId !== undefined &&
        event.collectorRunId !== options.collectorRunId
      ) {
        continue;
      }
      if (
        enforceReceiveOrder &&
        lastSelectedReceivedTimestampMs !== undefined &&
        event.receivedTimestampMs < lastSelectedReceivedTimestampMs
      ) {
        throw new Error(
          `Receive time moved backwards at ` +
            `${part.relativePath}:${lineNumber}`
        );
      }
      lastSelectedReceivedTimestampMs = event.receivedTimestampMs;
      yield {
        event,
        journalId: part.journalId,
        lineNumber
      };
    }
    completed = true;
  } catch (error) {
    streamError = error;
  } finally {
    lines.close();
    if (!completed) {
      decoded.destroy();
      raw.destroy();
    }
    try {
      await pump;
    } catch (error) {
      streamError ??= error;
    }
  }
  if (streamError !== undefined) {
    throw streamError;
  }

  assertEqual(
    lineNumber,
    part.metadata.eventCount,
    "Journal event count",
    part.relativePath
  );
  assertEqual(
    firstReceivedTimestampMs ?? -1,
    part.metadata.firstReceivedTimestampMs,
    "First receive time",
    part.relativePath
  );
  assertEqual(
    lastReceivedTimestampMs ?? -1,
    part.metadata.lastReceivedTimestampMs,
    "Last receive time",
    part.relativePath
  );
  assertEqual(
    sourceObservation.bytes,
    part.metadata.bytes,
    "Journal bytes",
    part.relativePath
  );
  assertEqual(
    sourceObservation.hash.digest("hex"),
    part.metadata.sha256,
    "Journal SHA-256",
    part.relativePath
  );
  if (
    part.representation === "gzip" &&
    compressedObservation !== undefined &&
    part.compressionMetadata !== undefined
  ) {
    assertEqual(
      compressedObservation.bytes,
      part.compressionMetadata.compressedBytes,
      "Compressed bytes",
      part.relativePath
    );
    assertEqual(
      compressedObservation.hash.digest("hex"),
      part.compressionMetadata.compressedSha256,
      "Compressed SHA-256",
      part.relativePath
    );
  }
}

export async function* readClosedJournalPart(
  part: ClosedJournalPart,
  options: ReadJournalOptions = {}
): AsyncGenerator<ReplayPosition> {
  yield* readClosedJournalPartInternal(part, options, true);
}

function seriesKey(part: ClosedJournalPart): string {
  return [
    part.metadata.venue,
    part.metadata.product,
    part.metadata.eventType
  ].join("|");
}

async function* readSeries(
  parts: readonly ClosedJournalPart[],
  options: ReadJournalOptions
): AsyncGenerator<ReplayPosition> {
  if (parts[0]?.metadata.eventType === "feed_status") {
    const buffered: ReplayPosition[] = [];
    for (const part of parts) {
      for await (const position of readClosedJournalPartInternal(
        part,
        options,
        false
      )) {
        buffered.push(position);
      }
    }
    buffered.sort(compareReplayPositions);
    for (const position of buffered) {
      yield position;
    }
    return;
  }
  for (const part of parts) {
    yield* readClosedJournalPart(part, options);
  }
}

function heapPush(heap: HeapEntry[], entry: HeapEntry): void {
  heap.push(entry);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (
      compareReplayPositions(
        heap[parent]!.position,
        heap[index]!.position
      ) <= 0
    ) {
      break;
    }
    [heap[parent], heap[index]] = [heap[index]!, heap[parent]!];
    index = parent;
  }
}

function heapPop(heap: HeapEntry[]): HeapEntry | undefined {
  const first = heap[0];
  const last = heap.pop();
  if (first === undefined || last === undefined) {
    return first;
  }
  if (heap.length === 0) {
    return first;
  }
  heap[0] = last;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    let smallest = index;
    if (
      left < heap.length &&
      compareReplayPositions(
        heap[left]!.position,
        heap[smallest]!.position
      ) < 0
    ) {
      smallest = left;
    }
    if (
      right < heap.length &&
      compareReplayPositions(
        heap[right]!.position,
        heap[smallest]!.position
      ) < 0
    ) {
      smallest = right;
    }
    if (smallest === index) {
      break;
    }
    [heap[index], heap[smallest]] = [
      heap[smallest]!,
      heap[index]!
    ];
    index = smallest;
  }
  return first;
}

export async function* readMergedJournalParts(
  parts: readonly ClosedJournalPart[],
  options: ReadJournalOptions = {}
): AsyncGenerator<ReplayPosition> {
  const grouped = new Map<string, ClosedJournalPart[]>();
  for (const part of parts) {
    const key = seriesKey(part);
    const series = grouped.get(key) ?? [];
    series.push(part);
    grouped.set(key, series);
  }

  const iterators = [...grouped.values()].map((series) =>
    readSeries(
      [...series].sort((left, right) =>
        left.relativePath.localeCompare(right.relativePath)
      ),
      options
    )[Symbol.asyncIterator]()
  );
  const heap: HeapEntry[] = [];
  try {
    for (const iterator of iterators) {
      const next = await iterator.next();
      if (!next.done) {
        heapPush(heap, { position: next.value, iterator });
      }
    }
    while (heap.length > 0) {
      const entry = heapPop(heap)!;
      yield entry.position;
      const next = await entry.iterator.next();
      if (!next.done) {
        heapPush(heap, {
          position: next.value,
          iterator: entry.iterator
        });
      }
    }
  } finally {
    await Promise.all(
      iterators.map(async (iterator) => {
        await iterator.return?.(undefined);
      })
    );
  }
}
