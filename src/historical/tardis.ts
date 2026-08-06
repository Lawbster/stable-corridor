import { createHash, randomUUID } from "node:crypto";
import {
  createReadStream,
  createWriteStream
} from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  stat,
  unlink
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";

import { z } from "zod";

import {
  publishTemporaryFileAtomicExclusive,
  writeFileAtomic,
  writeFileAtomicExclusive
} from "../collector/filesystem/atomic-write.js";
import {
  journalCompressionMetadataSchema,
  type JournalCompressionMetadata
} from "../collector/journal/compression.js";
import {
  journalPartMetadataSchema
} from "../collector/journal/metadata.js";
import {
  formatUtcDate,
  journalDirectory,
  journalPartBaseName,
  resolveContainedPath,
  type JournalRoute
} from "../collector/journal/path.js";
import {
  bookCheckpointEventSchema,
  tradeEventSchema,
  type NormalizedEvent
} from "../collector/schema/events.js";
import {
  normalizeDecimalString
} from "../collector/schema/primitives.js";
import {
  canonicalJsonLine
} from "../collector/serialization.js";

type BookCheckpointEvent = Extract<
  NormalizedEvent,
  { readonly eventType: "book_checkpoint" }
>;
type TradeEvent = Extract<
  NormalizedEvent,
  { readonly eventType: "trade" }
>;

export type TardisDataType = "book_snapshot_5" | "trades";

export interface TardisDatasetRoute {
  readonly exchange: "coinbase" | "binance" | "bybit-spot" | "kraken";
  readonly symbol: string;
  readonly nativeSymbol?: string;
  readonly dataType: TardisDataType;
  readonly venue: "coinbase" | "binance" | "bybit" | "kraken";
  readonly product: string;
  readonly eventType: "book_checkpoint" | "trade";
}

export interface TardisCacheRecord {
  readonly schemaVersion: 1;
  readonly recordType: "tardis_free_dataset_cache";
  readonly sourceUrl: string;
  readonly date: string;
  readonly exchange: string;
  readonly symbol: string;
  readonly dataType: TardisDataType;
  readonly bytes: number;
  readonly md5: string;
  readonly downloadedAtMs: number;
}

export interface DownloadTardisDatasetOptions {
  readonly cacheRoot: string;
  readonly date: string;
  readonly route: TardisDatasetRoute;
  readonly maxFileBytes?: number;
  readonly fetchImplementation?: typeof fetch;
  readonly now?: () => number;
}

export interface DownloadedTardisDataset {
  readonly path: string;
  readonly metadataPath: string;
  readonly metadata: TardisCacheRecord;
  readonly cacheHit: boolean;
}

export interface ImportedTardisPart {
  readonly route: TardisDatasetRoute;
  readonly date: string;
  readonly rawPath: string;
  readonly outputPath: string | null;
  readonly eventCount: number;
  readonly sourceBytes: number;
  readonly compressedBytes: number;
  readonly skippedExisting: boolean;
}

export interface ImportFreeTardisHistoryOptions {
  readonly cacheRoot: string;
  readonly dataRoot: string;
  readonly dates: readonly string[];
  readonly maxFileBytes?: number;
  readonly fetchImplementation?: typeof fetch;
  readonly now?: () => number;
  readonly onProgress?: (message: string) => void;
}

export interface ImportFreeTardisHistoryResult {
  readonly schemaVersion: 1;
  readonly recordType: "tardis_free_history_import";
  readonly collectorRunId: string;
  readonly dates: readonly string[];
  readonly routes: readonly TardisDatasetRoute[];
  readonly parts: readonly ImportedTardisPart[];
  readonly downloadedFiles: number;
  readonly cacheHits: number;
  readonly importedParts: number;
  readonly skippedExistingParts: number;
  readonly importedEvents: number;
  readonly sourceBytes: number;
  readonly compressedBytes: number;
  readonly completedAtMs: number;
}

interface StreamObservation {
  bytes: number;
  readonly hash: ReturnType<typeof createHash>;
}

interface WrittenPart {
  readonly outputPath: string | null;
  readonly eventCount: number;
  readonly sourceBytes: number;
  readonly compressedBytes: number;
  readonly skippedExisting: boolean;
}

const cacheRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  recordType: z.literal("tardis_free_dataset_cache"),
  sourceUrl: z.url(),
  date: z.string().regex(/^\d{4}-\d{2}-01$/u),
  exchange: z.string().min(1).max(64),
  symbol: z.string().min(1).max(128),
  dataType: z.enum(["book_snapshot_5", "trades"]),
  bytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  md5: z.string().regex(/^[0-9a-f]{32}$/u),
  downloadedAtMs: z.number().int().nonnegative()
});

const bookHeader = [
  "exchange",
  "symbol",
  "timestamp",
  "local_timestamp",
  "asks[0].price",
  "asks[0].amount",
  "bids[0].price",
  "bids[0].amount",
  "asks[1].price",
  "asks[1].amount",
  "bids[1].price",
  "bids[1].amount",
  "asks[2].price",
  "asks[2].amount",
  "bids[2].price",
  "bids[2].amount",
  "asks[3].price",
  "asks[3].amount",
  "bids[3].price",
  "bids[3].amount",
  "asks[4].price",
  "asks[4].amount",
  "bids[4].price",
  "bids[4].amount"
] as const;

const tradeHeader = [
  "exchange",
  "symbol",
  "timestamp",
  "local_timestamp",
  "id",
  "side",
  "price",
  "amount"
] as const;

export const freeTardisRoutes: readonly TardisDatasetRoute[] = [
  {
    exchange: "coinbase",
    symbol: "EURC-USDC",
    dataType: "book_snapshot_5",
    venue: "coinbase",
    product: "EURC-USDC",
    eventType: "book_checkpoint"
  },
  {
    exchange: "coinbase",
    symbol: "EURC-USDC",
    dataType: "trades",
    venue: "coinbase",
    product: "EURC-USDC",
    eventType: "trade"
  },
  {
    exchange: "binance",
    symbol: "EURUSDC",
    dataType: "book_snapshot_5",
    venue: "binance",
    product: "EUR-USDC",
    eventType: "book_checkpoint"
  },
  {
    exchange: "bybit-spot",
    symbol: "USDCEUR",
    dataType: "book_snapshot_5",
    venue: "bybit",
    product: "USDC-EUR",
    eventType: "book_checkpoint"
  },
  {
    exchange: "kraken",
    symbol: "USDC-EUR",
    nativeSymbol: "USDC/EUR",
    dataType: "book_snapshot_5",
    venue: "kraken",
    product: "USDC-EUR",
    eventType: "book_checkpoint"
  }
];

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

async function regularFileExists(path: string): Promise<boolean> {
  try {
    const information = await lstat(path);
    if (information.isSymbolicLink()) {
      throw new Error(`Symbolic links are not supported: ${path}`);
    }
    return information.isFile();
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function assertFreeDate(date: string): void {
  if (!/^\d{4}-\d{2}-01$/u.test(date)) {
    throw new Error(
      `Tardis free-history requests must be first-of-month dates: ${date}`
    );
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    throw new Error(`Invalid UTC date: ${date}`);
  }
}

export function firstOfMonthDates(
  fromMonth: string,
  toMonth: string
): string[] {
  if (
    !/^\d{4}-\d{2}$/u.test(fromMonth) ||
    !/^\d{4}-\d{2}$/u.test(toMonth)
  ) {
    throw new Error("Months must use YYYY-MM format");
  }
  const from = new Date(`${fromMonth}-01T00:00:00.000Z`);
  const to = new Date(`${toMonth}-01T00:00:00.000Z`);
  if (
    Number.isNaN(from.getTime()) ||
    Number.isNaN(to.getTime()) ||
    from.toISOString().slice(0, 7) !== fromMonth ||
    to.toISOString().slice(0, 7) !== toMonth ||
    from.getTime() > to.getTime()
  ) {
    throw new Error(`Invalid month range: ${fromMonth}..${toMonth}`);
  }
  const output: string[] = [];
  const cursor = new Date(from);
  while (cursor.getTime() <= to.getTime()) {
    output.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return output;
}

function deterministicUuid(label: string): string {
  const bytes = createHash("sha256").update(label).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join("-");
}

export const tardisCollectorRunId = deterministicUuid(
  "stable-corridor:tardis-free-history:v1"
);

export function normalizeTardisDecimal(input: string): string {
  if (!/[eE]/u.test(input)) {
    return normalizeDecimalString(input);
  }
  const match =
    /^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/u.exec(input);
  if (match === null) {
    throw new Error(`Invalid Tardis decimal string: ${input}`);
  }
  const sign = match[1]!;
  const integer = match[2]!;
  const fraction = match[3] ?? "";
  const exponent = Number(match[4]);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 256) {
    throw new Error(`Tardis decimal exponent is out of range: ${input}`);
  }
  const digits = `${integer}${fraction}`;
  const decimalPosition = integer.length + exponent;
  const expanded =
    decimalPosition <= 0
      ? `${sign}0.${"0".repeat(-decimalPosition)}${digits}`
      : decimalPosition >= digits.length
        ? `${sign}${digits}${"0".repeat(decimalPosition - digits.length)}`
        : `${sign}${digits.slice(0, decimalPosition)}.` +
          digits.slice(decimalPosition);
  return normalizeDecimalString(expanded);
}

function connectionId(
  date: string,
  route: TardisDatasetRoute
): string {
  return deterministicUuid(
    [
      "stable-corridor:tardis-free-history:v1",
      date,
      route.exchange,
      route.symbol,
      route.dataType
    ].join(":")
  );
}

function datasetUrl(
  date: string,
  route: TardisDatasetRoute
): string {
  assertFreeDate(date);
  const [year, month, day] = date.split("-");
  return (
    "https://datasets.tardis.dev/v1/" +
    `${route.exchange}/${route.dataType}/` +
    `${year}/${month}/${day}/${route.symbol}.csv.gz`
  );
}

function cachePaths(
  cacheRoot: string,
  date: string,
  route: TardisDatasetRoute
): { readonly dataPath: string; readonly metadataPath: string } {
  const root = resolve(cacheRoot);
  const dataPath = resolveContainedPath(
    root,
    route.exchange,
    route.dataType,
    date,
    `${route.symbol}.csv.gz`
  );
  return {
    dataPath,
    metadataPath: `${dataPath}.meta.json`
  };
}

async function md5File(path: string): Promise<string> {
  const hash = createHash("md5");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

function responseMd5(response: Response): string | undefined {
  const raw = response.headers.get("x-md5");
  if (raw === null) {
    return undefined;
  }
  const normalized = raw.replaceAll('"', "").trim().toLowerCase();
  return /^[0-9a-f]{32}$/u.test(normalized) ? normalized : undefined;
}

export async function downloadFreeTardisDataset(
  options: DownloadTardisDatasetOptions
): Promise<DownloadedTardisDataset> {
  assertFreeDate(options.date);
  const { dataPath, metadataPath } = cachePaths(
    options.cacheRoot,
    options.date,
    options.route
  );
  const sourceUrl = datasetUrl(options.date, options.route);
  const dataPresent = await regularFileExists(dataPath);
  const metadataPresent = await regularFileExists(metadataPath);
  if (dataPresent || metadataPresent) {
    if (!dataPresent || !metadataPresent) {
      throw new Error(`Incomplete Tardis cache entry: ${dataPath}`);
    }
    const metadata = cacheRecordSchema.parse(
      JSON.parse(await readFile(metadataPath, "utf8"))
    );
    const information = await stat(dataPath);
    if (
      metadata.sourceUrl !== sourceUrl ||
      metadata.bytes !== information.size ||
      metadata.md5 !== (await md5File(dataPath))
    ) {
      throw new Error(`Tardis cache verification failed: ${dataPath}`);
    }
    return {
      path: dataPath,
      metadataPath,
      metadata,
      cacheHit: true
    };
  }

  const fetchImplementation = options.fetchImplementation ?? fetch;
  const response = await fetchImplementation(sourceUrl, {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(120_000)
  });
  if (!response.ok) {
    throw new Error(
      `Tardis dataset request failed: ${response.status} ${sourceUrl}`
    );
  }
  const advertisedBytes = Number(
    response.headers.get("x-dataset-size") ??
      response.headers.get("content-length")
  );
  const maxFileBytes = options.maxFileBytes ?? 100_000_000;
  if (
    !Number.isSafeInteger(advertisedBytes) ||
    advertisedBytes < 1 ||
    advertisedBytes > maxFileBytes
  ) {
    throw new Error(
      `Tardis dataset size is invalid or exceeds the bound: ` +
        `${advertisedBytes} ${sourceUrl}`
    );
  }
  const contents = new Uint8Array(await response.arrayBuffer());
  if (
    contents.byteLength !== advertisedBytes ||
    contents[0] !== 0x1f ||
    contents[1] !== 0x8b
  ) {
    throw new Error(`Invalid Tardis gzip response: ${sourceUrl}`);
  }
  const md5 = createHash("md5").update(contents).digest("hex");
  const expectedMd5 = responseMd5(response);
  if (expectedMd5 === undefined || md5 !== expectedMd5) {
    throw new Error(`Tardis response MD5 mismatch: ${sourceUrl}`);
  }
  const now = options.now ?? Date.now;
  const metadata = cacheRecordSchema.parse({
    schemaVersion: 1,
    recordType: "tardis_free_dataset_cache",
    sourceUrl,
    date: options.date,
    exchange: options.route.exchange,
    symbol: options.route.symbol,
    dataType: options.route.dataType,
    bytes: contents.byteLength,
    md5,
    downloadedAtMs: now()
  });
  await writeFileAtomic(dataPath, contents);
  await writeFileAtomic(
    metadataPath,
    canonicalJsonLine(metadata)
  );
  return {
    path: dataPath,
    metadataPath,
    metadata,
    cacheHit: false
  };
}

function microsecondsToMilliseconds(value: string): number {
  if (!/^\d+$/u.test(value)) {
    throw new Error(`Invalid microsecond timestamp: ${value}`);
  }
  const milliseconds = BigInt(value) / 1_000n;
  const output = Number(milliseconds);
  if (!Number.isSafeInteger(output)) {
    throw new Error(`Timestamp exceeds the safe range: ${value}`);
  }
  return output;
}

function splitRow(
  line: string,
  expectedColumns: number,
  rowNumber: number
): string[] {
  const values = line.split(",");
  if (values.length !== expectedColumns) {
    throw new Error(
      `Unexpected CSV column count at row ${rowNumber}: ` +
        `${values.length} != ${expectedColumns}`
    );
  }
  return values;
}

function assertIdentity(
  values: readonly string[],
  route: TardisDatasetRoute,
  rowNumber: number
): void {
  if (
    values[0] !== route.exchange ||
    values[1] !== (route.nativeSymbol ?? route.symbol)
  ) {
    throw new Error(
      `Tardis route mismatch at row ${rowNumber}: ` +
        `${values[0]} ${values[1]}`
    );
  }
}

function bookLevels(
  values: readonly string[],
  priceOffset: number,
  quantityOffset: number
): { readonly price: string; readonly quantity: string }[] {
  const output: { readonly price: string; readonly quantity: string }[] =
    [];
  for (let level = 0; level < 5; level += 1) {
    const price = values[priceOffset + level * 4]!;
    const quantity = values[quantityOffset + level * 4]!;
    if (price.length === 0 && quantity.length === 0) {
      continue;
    }
    if (price.length === 0 || quantity.length === 0) {
      throw new Error("Incomplete Tardis book level");
    }
    output.push({
      price: normalizeTardisDecimal(price),
      quantity: normalizeTardisDecimal(quantity)
    });
  }
  return output;
}

async function* readBookEvents(
  rawPath: string,
  date: string,
  route: TardisDatasetRoute
): AsyncGenerator<BookCheckpointEvent> {
  const lines = createInterface({
    input: createReadStream(rawPath).pipe(createGunzip()),
    crlfDelay: Number.POSITIVE_INFINITY
  });
  let rowNumber = 0;
  let previousReceivedTimestampMs: number | undefined;
  for await (const line of lines) {
    rowNumber += 1;
    if (rowNumber === 1) {
      if (line !== bookHeader.join(",")) {
        throw new Error(`Unexpected Tardis book header: ${rawPath}`);
      }
      continue;
    }
    if (line.length === 0) {
      throw new Error(`Empty Tardis row ${rowNumber}: ${rawPath}`);
    }
    const values = splitRow(line, bookHeader.length, rowNumber);
    assertIdentity(values, route, rowNumber);
    const sourceTimestampMs = microsecondsToMilliseconds(values[2]!);
    const receivedTimestampMs = microsecondsToMilliseconds(values[3]!);
    if (
      previousReceivedTimestampMs !== undefined &&
      receivedTimestampMs < previousReceivedTimestampMs
    ) {
      throw new Error(`Tardis receive time moved backwards: ${rawPath}`);
    }
    if (formatUtcDate(receivedTimestampMs) !== date) {
      throw new Error(`Tardis row falls outside requested date: ${rawPath}`);
    }
    previousReceivedTimestampMs = receivedTimestampMs;
    const asks = bookLevels(values, 4, 5);
    const bids = bookLevels(values, 6, 7);
    const depth = Math.max(asks.length, bids.length);
    if (asks.length === 0 || bids.length === 0 || depth === 0) {
      throw new Error(`Empty Tardis book at row ${rowNumber}: ${rawPath}`);
    }
    yield bookCheckpointEventSchema.parse({
      schemaVersion: 1,
      eventType: "book_checkpoint",
      venue: route.venue,
      product: route.product,
      nativeProduct: route.nativeSymbol ?? route.symbol,
      sourceTimestampMs,
      receivedTimestampMs,
      ingestSequence: rowNumber - 1,
      collectorRunId: tardisCollectorRunId,
      connectionId: connectionId(date, route),
      venueSequence: null,
      source: "external",
      payload: {
        bids,
        asks,
        depth,
        checksum: null,
        isRecovery: rowNumber === 2
      }
    });
  }
  if (rowNumber === 0) {
    throw new Error(`Empty gzip dataset: ${rawPath}`);
  }
}

async function* readTradeEvents(
  rawPath: string,
  date: string,
  route: TardisDatasetRoute
): AsyncGenerator<TradeEvent> {
  const lines = createInterface({
    input: createReadStream(rawPath).pipe(createGunzip()),
    crlfDelay: Number.POSITIVE_INFINITY
  });
  let rowNumber = 0;
  let previousReceivedTimestampMs: number | undefined;
  for await (const line of lines) {
    rowNumber += 1;
    if (rowNumber === 1) {
      if (line !== tradeHeader.join(",")) {
        throw new Error(`Unexpected Tardis trade header: ${rawPath}`);
      }
      continue;
    }
    if (line.length === 0) {
      throw new Error(`Empty Tardis row ${rowNumber}: ${rawPath}`);
    }
    const values = splitRow(line, tradeHeader.length, rowNumber);
    assertIdentity(values, route, rowNumber);
    const sourceTimestampMs = microsecondsToMilliseconds(values[2]!);
    const receivedTimestampMs = microsecondsToMilliseconds(values[3]!);
    if (
      previousReceivedTimestampMs !== undefined &&
      receivedTimestampMs < previousReceivedTimestampMs
    ) {
      throw new Error(`Tardis receive time moved backwards: ${rawPath}`);
    }
    if (formatUtcDate(receivedTimestampMs) !== date) {
      throw new Error(`Tardis row falls outside requested date: ${rawPath}`);
    }
    previousReceivedTimestampMs = receivedTimestampMs;
    const side = values[5];
    if (side !== "buy" && side !== "sell" && side !== "unknown") {
      throw new Error(`Invalid Tardis trade side: ${side}`);
    }
    yield tradeEventSchema.parse({
      schemaVersion: 1,
      eventType: "trade",
      venue: route.venue,
      product: route.product,
      nativeProduct: route.nativeSymbol ?? route.symbol,
      sourceTimestampMs,
      receivedTimestampMs,
      ingestSequence: rowNumber - 1,
      collectorRunId: tardisCollectorRunId,
      connectionId: connectionId(date, route),
      venueSequence: values[4]!.length === 0 ? null : values[4],
      source: "external",
      payload: {
        tradeId: values[4]!.length === 0 ? null : values[4],
        price: normalizeTardisDecimal(values[6]!),
        quantity: normalizeTardisDecimal(values[7]!),
        aggressorSide: side
      }
    });
  }
  if (rowNumber === 0) {
    throw new Error(`Empty gzip dataset: ${rawPath}`);
  }
}

export function readTardisEvents(
  rawPath: string,
  date: string,
  route: TardisDatasetRoute
): AsyncIterable<NormalizedEvent> {
  assertFreeDate(date);
  return route.eventType === "book_checkpoint"
    ? readBookEvents(rawPath, date, route)
    : readTradeEvents(rawPath, date, route);
}

function observingTransform(
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

function journalRoute(route: TardisDatasetRoute): JournalRoute {
  return {
    venue: route.venue,
    product: route.product,
    eventType: route.eventType
  };
}

async function writeNormalizedGzipPart(
  dataRoot: string,
  date: string,
  route: TardisDatasetRoute,
  events: AsyncIterable<NormalizedEvent>,
  now: () => number
): Promise<WrittenPart> {
  const directory = journalDirectory(dataRoot, date, journalRoute(route));
  const sourceName = journalPartBaseName(route.eventType, 1);
  const sourcePath = join(directory, sourceName);
  const metadataPath = `${sourcePath}.meta.json`;
  const compressedPath = `${sourcePath}.gz`;
  const compressionMetadataPath = `${compressedPath}.meta.json`;
  const existing = await Promise.all(
    [metadataPath, compressedPath, compressionMetadataPath].map(
      regularFileExists
    )
  );
  if (existing.some(Boolean)) {
    if (!existing.every(Boolean)) {
      throw new Error(`Incomplete imported journal part: ${sourcePath}`);
    }
    const metadata = journalPartMetadataSchema.parse(
      JSON.parse(await readFile(metadataPath, "utf8"))
    );
    const compressionMetadata = journalCompressionMetadataSchema.parse(
      JSON.parse(await readFile(compressionMetadataPath, "utf8"))
    );
    return {
      outputPath: compressedPath,
      eventCount: metadata.eventCount,
      sourceBytes: metadata.bytes,
      compressedBytes: compressionMetadata.compressedBytes,
      skippedExisting: true
    };
  }

  const iterator = events[Symbol.asyncIterator]();
  const first = await iterator.next();
  if (first.done === true) {
    return {
      outputPath: null,
      eventCount: 0,
      sourceBytes: 0,
      compressedBytes: 0,
      skippedExisting: false
    };
  }

  await mkdir(directory, { recursive: true });
  const temporaryPath = join(
    directory,
    `.${basename(compressedPath)}.${process.pid}.${randomUUID()}.tmp`
  );
  const sourceObservation: StreamObservation = {
    bytes: 0,
    hash: createHash("sha256")
  };
  const compressedObservation: StreamObservation = {
    bytes: 0,
    hash: createHash("sha256")
  };
  const gzip = createGzip({ level: 6 });
  const pump = pipeline(
    gzip,
    observingTransform(compressedObservation),
    createWriteStream(temporaryPath, {
      flags: "wx",
      mode: 0o600
    })
  );
  let eventCount = 0;
  let firstReceivedTimestampMs: number | undefined;
  let lastReceivedTimestampMs: number | undefined;
  try {
    let current: IteratorResult<NormalizedEvent> = first;
    while (current.done !== true) {
      const event = current.value;
      if (
        event.venue !== route.venue ||
        event.product !== route.product ||
        event.eventType !== route.eventType
      ) {
        throw new Error(`Imported event route mismatch: ${sourcePath}`);
      }
      if (
        lastReceivedTimestampMs !== undefined &&
        event.receivedTimestampMs < lastReceivedTimestampMs
      ) {
        throw new Error(`Imported receive time moved backwards: ${sourcePath}`);
      }
      const line = canonicalJsonLine(event);
      const bytes = Buffer.byteLength(line);
      sourceObservation.bytes += bytes;
      sourceObservation.hash.update(line);
      if (!gzip.write(line)) {
        await new Promise<void>((resolveDrain) => {
          gzip.once("drain", resolveDrain);
        });
      }
      eventCount += 1;
      firstReceivedTimestampMs ??= event.receivedTimestampMs;
      lastReceivedTimestampMs = event.receivedTimestampMs;
      current = await iterator.next();
    }
    gzip.end();
    await pump;
  } catch (error) {
    gzip.destroy();
    await pump.catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  if (
    eventCount === 0 ||
    firstReceivedTimestampMs === undefined ||
    lastReceivedTimestampMs === undefined
  ) {
    await unlink(temporaryPath).catch(() => undefined);
    throw new Error(`Cannot publish an empty imported journal: ${sourcePath}`);
  }
  const finalizedAtMs = Math.max(now(), lastReceivedTimestampMs);
  const sourceSha256 = sourceObservation.hash.digest("hex");
  const compressedSha256 = compressedObservation.hash.digest("hex");
  const sourceMetadata = journalPartMetadataSchema.parse({
    schemaVersion: 1,
    venue: route.venue,
    product: route.product,
    eventType: route.eventType,
    date,
    part: 1,
    fileName: sourceName,
    bytes: sourceObservation.bytes,
    eventCount,
    firstReceivedTimestampMs,
    lastReceivedTimestampMs,
    sha256: sourceSha256,
    compressionEligible: true,
    finalizedAtMs
  });
  const sourceMetadataContents = canonicalJsonLine(sourceMetadata);
  const compressionMetadata: JournalCompressionMetadata =
    journalCompressionMetadataSchema.parse({
      schemaVersion: 1,
      recordType: "journal_compression",
      algorithm: "gzip",
      level: 6,
      sourceFileName: sourceName,
      sourceMetadataFileName: basename(metadataPath),
      compressedFileName: basename(compressedPath),
      sourceBytes: sourceObservation.bytes,
      compressedBytes: compressedObservation.bytes,
      sourceSha256,
      sourceMetadataSha256: createHash("sha256")
        .update(sourceMetadataContents)
        .digest("hex"),
      compressedSha256,
      createdAtMs: finalizedAtMs
    });
  try {
    await publishTemporaryFileAtomicExclusive(
      temporaryPath,
      compressedPath
    );
    await writeFileAtomicExclusive(
      metadataPath,
      sourceMetadataContents
    );
    await writeFileAtomicExclusive(
      compressionMetadataPath,
      canonicalJsonLine(compressionMetadata)
    );
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  return {
    outputPath: compressedPath,
    eventCount,
    sourceBytes: sourceObservation.bytes,
    compressedBytes: compressedObservation.bytes,
    skippedExisting: false
  };
}

export async function importFreeTardisHistory(
  options: ImportFreeTardisHistoryOptions
): Promise<ImportFreeTardisHistoryResult> {
  const cacheRoot = resolve(options.cacheRoot);
  const dataRoot = resolve(options.dataRoot);
  resolveContainedPath(cacheRoot);
  resolveContainedPath(dataRoot);
  const dates = [...new Set(options.dates)].sort();
  if (dates.length === 0) {
    throw new Error("At least one free-history date is required");
  }
  dates.forEach(assertFreeDate);
  const now = options.now ?? Date.now;
  const parts: ImportedTardisPart[] = [];
  let downloadedFiles = 0;
  let cacheHits = 0;
  for (const date of dates) {
    for (const route of freeTardisRoutes) {
      options.onProgress?.(
        `Importing ${date} ${route.exchange} ` +
          `${route.symbol} ${route.dataType}`
      );
      const downloaded = await downloadFreeTardisDataset({
        cacheRoot,
        date,
        route,
        ...(options.maxFileBytes === undefined
          ? {}
          : { maxFileBytes: options.maxFileBytes }),
        ...(options.fetchImplementation === undefined
          ? {}
          : { fetchImplementation: options.fetchImplementation }),
        now
      });
      if (downloaded.cacheHit) {
        cacheHits += 1;
      } else {
        downloadedFiles += 1;
      }
      const written = await writeNormalizedGzipPart(
        dataRoot,
        date,
        route,
        readTardisEvents(downloaded.path, date, route),
        now
      );
      parts.push({
        route,
        date,
        rawPath: downloaded.path,
        outputPath: written.outputPath,
        eventCount: written.eventCount,
        sourceBytes: written.sourceBytes,
        compressedBytes: written.compressedBytes,
        skippedExisting: written.skippedExisting
      });
    }
  }
  const result: ImportFreeTardisHistoryResult = {
    schemaVersion: 1,
    recordType: "tardis_free_history_import",
    collectorRunId: tardisCollectorRunId,
    dates,
    routes: freeTardisRoutes,
    parts,
    downloadedFiles,
    cacheHits,
    importedParts: parts.filter(
      (part) =>
        part.outputPath !== null &&
        !part.skippedExisting
    ).length,
    skippedExistingParts: parts.filter(
      (part) => part.skippedExisting
    ).length,
    importedEvents: parts.reduce(
      (total, part) => total + part.eventCount,
      0
    ),
    sourceBytes: parts.reduce(
      (total, part) => total + part.sourceBytes,
      0
    ),
    compressedBytes: parts.reduce(
      (total, part) => total + part.compressedBytes,
      0
    ),
    completedAtMs: now()
  };
  await writeFileAtomic(
    resolveContainedPath(cacheRoot, "tardis-import-manifest.json"),
    canonicalJsonLine(result)
  );
  return result;
}
