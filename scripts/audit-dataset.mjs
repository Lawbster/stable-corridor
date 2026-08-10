import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  readdir,
  stat,
  writeFile
} from "node:fs/promises";
import { once } from "node:events";
import { dirname, relative, resolve, sep } from "node:path";
import { Transform } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { createGunzip, createGzip } from "node:zlib";

const eventTypes = new Set([
  "instrument",
  "book_checkpoint",
  "book_delta",
  "trade",
  "dex_quote",
  "trade_continuity",
  "market_status",
  "feed_status",
  "public_rail_status"
]);
const closedJournalPattern =
  /^normalized\/(\d{4}-\d{2}-\d{2})\/([^/]+)\/([^/]+)\/([a-z_]+)-(\d{6})\.jsonl$/u;
const runManifestPattern =
  /^runs\/([0-9a-f-]+)\/(start|end)\.json$/u;

function canonicalize(value) {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  const output = {};
  for (const key of Object.keys(value).sort()) {
    output[key] = canonicalize(value[key]);
  }
  return output;
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function increment(record, key, amount = 1) {
  record[key] = (record[key] ?? 0) + amount;
}

function sortedRecord(record) {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) =>
      left.localeCompare(right)
    )
  );
}

function round(value, digits = 6) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function percentile(sortedValues, proportion) {
  if (sortedValues.length === 0) {
    return null;
  }
  return sortedValues[
    Math.floor((sortedValues.length - 1) * proportion)
  ];
}

const maximumLatencySamples = 8_192;

function newLatencyAccumulator() {
  return {
    observations: 0,
    negativeObservations: 0,
    minimumMs: null,
    maximumMs: null,
    samples: [],
    randomState: 0x6d2b79f5
  };
}

function nextDeterministicRandom(accumulator) {
  let state = accumulator.randomState;
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  accumulator.randomState = state >>> 0;
  return accumulator.randomState / 0x1_0000_0000;
}

function observeLatency(accumulator, value) {
  accumulator.observations += 1;
  if (value < 0) {
    accumulator.negativeObservations += 1;
  }
  accumulator.minimumMs =
    accumulator.minimumMs === null
      ? value
      : Math.min(accumulator.minimumMs, value);
  accumulator.maximumMs =
    accumulator.maximumMs === null
      ? value
      : Math.max(accumulator.maximumMs, value);
  if (accumulator.samples.length < maximumLatencySamples) {
    accumulator.samples.push(value);
    return;
  }
  const replacementIndex = Math.floor(
    nextDeterministicRandom(accumulator) * accumulator.observations
  );
  if (replacementIndex < maximumLatencySamples) {
    accumulator.samples[replacementIndex] = value;
  }
}

function latencySummary(accumulator) {
  const values = [...accumulator.samples].sort(
    (left, right) => left - right
  );
  return {
    observations: accumulator.observations,
    negativeObservations: accumulator.negativeObservations,
    sampleSize: values.length,
    quantileMethod:
      accumulator.observations === values.length
        ? "exact"
        : "deterministic_reservoir",
    minimumMs: accumulator.minimumMs,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    p99Ms: percentile(values, 0.99),
    maximumMs: accumulator.maximumMs
  };
}

function parseArguments(arguments_) {
  const options = {
    dataRoot: resolve("data"),
    output: resolve("state", "dataset-audit.json"),
    compression: "gzip"
  };

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if (argument === "--data-root" && value !== undefined) {
      options.dataRoot = resolve(value);
      index += 1;
    } else if (argument === "--output" && value !== undefined) {
      options.output = value === "-" ? "-" : resolve(value);
      index += 1;
    } else if (
      argument === "--compression" &&
      (value === "gzip" || value === "none")
    ) {
      options.compression = value;
      index += 1;
    } else if (argument === "--help") {
      console.log(
        "Usage: node scripts/audit-dataset.mjs " +
          "[--data-root PATH] [--output PATH|-] " +
          "[--compression gzip|none]"
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
  }
  return options;
}

async function walkFiles(root) {
  const output = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      output.push(...(await walkFiles(path)));
    } else if (entry.isFile()) {
      output.push(path);
    } else {
      output.push(path);
    }
  }
  return output;
}

function parseRoute(relativePath) {
  const match = closedJournalPattern.exec(relativePath);
  if (match === null || !eventTypes.has(match[4])) {
    return null;
  }
  return {
    date: match[1],
    venue: match[2],
    product: match[3],
    eventType: match[4],
    part: Number.parseInt(match[5], 10),
    fileName: relativePath.split("/").at(-1)
  };
}

function newAggregate() {
  return {
    closedBytes: 0,
    gzipBytes: 0,
    events: 0,
    firstReceivedTimestampMs: null,
    lastReceivedTimestampMs: null,
    eventTypes: {},
    latency: newLatencyAccumulator()
  };
}

function newSequenceObservation() {
  return {
    uniqueSequences: 0,
    words: new Uint32Array(32)
  };
}

function observeIngestSequence(observation, sequence) {
  const wordIndex = Math.floor(sequence / 32);
  if (wordIndex >= observation.words.length) {
    let nextLength = observation.words.length;
    while (nextLength <= wordIndex) {
      nextLength *= 2;
    }
    const words = new Uint32Array(nextLength);
    words.set(observation.words);
    observation.words = words;
  }
  const mask = (1 << (sequence % 32)) >>> 0;
  if ((observation.words[wordIndex] & mask) !== 0) {
    return false;
  }
  observation.words[wordIndex] |= mask;
  observation.uniqueSequences += 1;
  return true;
}

function observeTimestamp(aggregate, receivedTimestampMs) {
  aggregate.firstReceivedTimestampMs =
    aggregate.firstReceivedTimestampMs === null
      ? receivedTimestampMs
      : Math.min(
          aggregate.firstReceivedTimestampMs,
          receivedTimestampMs
        );
  aggregate.lastReceivedTimestampMs =
    aggregate.lastReceivedTimestampMs === null
      ? receivedTimestampMs
      : Math.max(
          aggregate.lastReceivedTimestampMs,
          receivedTimestampMs
        );
}

function observeEvent(context, route, event, filePath, lineNumber) {
  if (event === null || typeof event !== "object" || Array.isArray(event)) {
    throw new Error(`${filePath}:${lineNumber}: event is not an object`);
  }
  if (
    event.schemaVersion !== 1 ||
    event.venue !== route.venue ||
    event.product !== route.product ||
    event.eventType !== route.eventType
  ) {
    throw new Error(
      `${filePath}:${lineNumber}: event does not match its journal route`
    );
  }
  if (
    !Number.isSafeInteger(event.receivedTimestampMs) ||
    event.receivedTimestampMs < 0 ||
    !Number.isSafeInteger(event.ingestSequence) ||
    event.ingestSequence < 0 ||
    typeof event.collectorRunId !== "string" ||
    typeof event.connectionId !== "string"
  ) {
    throw new Error(
      `${filePath}:${lineNumber}: invalid common event envelope`
    );
  }

  const venue =
    context.byVenue[route.venue] ??
    (context.byVenue[route.venue] = newAggregate());
  const productKey = `${route.venue}|${route.product}`;
  const product =
    context.byProduct[productKey] ??
    (context.byProduct[productKey] = newAggregate());
  const feedEventTypeKey =
    `${route.venue}|${route.product}|${route.eventType}`;
  const feedEventType =
    context.byFeedEventType[feedEventTypeKey] ??
    (context.byFeedEventType[feedEventTypeKey] = newAggregate());
  for (const aggregate of [
    context.total,
    venue,
    product,
    feedEventType
  ]) {
    aggregate.events += 1;
    increment(aggregate.eventTypes, route.eventType);
    observeTimestamp(aggregate, event.receivedTimestampMs);
  }

  if (Number.isSafeInteger(event.sourceTimestampMs)) {
    const latency = event.receivedTimestampMs - event.sourceTimestampMs;
    observeLatency(context.total.latency, latency);
    observeLatency(venue.latency, latency);
    observeLatency(product.latency, latency);
    observeLatency(feedEventType.latency, latency);
  }

  const run =
    context.runs.get(event.collectorRunId) ??
    {
      events: 0,
      minimumIngestSequence: null,
      maximumIngestSequence: null,
      duplicateIngestSequences: 0,
      ingestSequences: newSequenceObservation(),
      connectionIds: new Set()
    };
  run.events += 1;
  run.minimumIngestSequence =
    run.minimumIngestSequence === null
      ? event.ingestSequence
      : Math.min(run.minimumIngestSequence, event.ingestSequence);
  run.maximumIngestSequence =
    run.maximumIngestSequence === null
      ? event.ingestSequence
      : Math.max(run.maximumIngestSequence, event.ingestSequence);
  if (!observeIngestSequence(run.ingestSequences, event.ingestSequence)) {
    run.duplicateIngestSequences += 1;
  }
  run.connectionIds.add(event.connectionId);
  context.runs.set(event.collectorRunId, run);

  if (route.eventType === "feed_status") {
    const payload = event.payload;
    const state =
      payload !== null && typeof payload === "object"
        ? payload.state
        : undefined;
    const reason =
      payload !== null && typeof payload === "object"
        ? payload.reason
        : undefined;
    if (typeof state !== "string") {
      throw new Error(
        `${filePath}:${lineNumber}: invalid feed-status payload`
      );
    }
    increment(
      context.feedStatusReasons,
      `${route.venue}|${route.product}|${state}|${reason ?? "none"}`
    );
  }
  if (route.eventType === "trade_continuity") {
    const payload = event.payload;
    if (
      payload === null ||
      typeof payload !== "object" ||
      (payload.messageType !== "snapshot" &&
        payload.messageType !== "update") ||
      typeof payload.nonAdjacentIdObserved !== "boolean" ||
      !Number.isSafeInteger(payload.acceptedTradeCount) ||
      !Number.isSafeInteger(payload.overlapTradeCount) ||
      !Number.isSafeInteger(payload.duplicateTradeCount) ||
      payload.acceptedTradeCount < 0 ||
      payload.overlapTradeCount < 0 ||
      payload.duplicateTradeCount < 0
    ) {
      throw new Error(
        `${filePath}:${lineNumber}: invalid trade-continuity payload`
      );
    }
    increment(
      context.tradeContinuity,
      `${route.venue}|${route.product}|${payload.messageType}|` +
        `non_adjacent=${payload.nonAdjacentIdObserved}|` +
        `overlap=${payload.overlapTradeCount > 0}|` +
        `duplicate=${payload.duplicateTradeCount > 0}`
    );
    const totalsKey = `${route.venue}|${route.product}`;
    const totals =
      context.tradeContinuityTotals[totalsKey] ??
      (context.tradeContinuityTotals[totalsKey] = {
        messages: 0,
        snapshots: 0,
        updates: 0,
        acceptedTrades: 0,
        overlapTrades: 0,
        duplicateTrades: 0,
        nonAdjacentMessages: 0
      });
    totals.messages += 1;
    if (payload.messageType === "snapshot") {
      totals.snapshots += 1;
    } else {
      totals.updates += 1;
    }
    totals.acceptedTrades += payload.acceptedTradeCount;
    totals.overlapTrades += payload.overlapTradeCount;
    totals.duplicateTrades += payload.duplicateTradeCount;
    if (payload.nonAdjacentIdObserved) {
      totals.nonAdjacentMessages += 1;
    }
  }
}

async function analyzeJournalChunks(
  chunks,
  displayPath,
  route,
  context,
  compression
) {
  const decoder = new StringDecoder("utf8");
  const hash = createHash("sha256");
  const gzip =
    compression === "gzip" ? createGzip({ level: 6 }) : undefined;
  let gzipBytes = 0;
  let pending = "";
  let eventCount = 0;
  let bytes = 0;
  let firstReceivedTimestampMs;
  let lastReceivedTimestampMs;

  if (gzip !== undefined) {
    gzip.on("data", (chunk) => {
      gzipBytes += chunk.length;
    });
  }

  try {
    for await (const chunk of chunks) {
      bytes += chunk.length;
      hash.update(chunk);
      if (gzip !== undefined && !gzip.write(chunk)) {
        await once(gzip, "drain");
      }
      pending += decoder.write(chunk);
      let newlineIndex = pending.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = pending.slice(0, newlineIndex);
        pending = pending.slice(newlineIndex + 1);
        eventCount += 1;
        if (line.length === 0) {
          throw new Error(`${displayPath}:${eventCount}: empty line`);
        }
        const event = JSON.parse(line);
        observeEvent(context, route, event, displayPath, eventCount);
        firstReceivedTimestampMs ??= event.receivedTimestampMs;
        lastReceivedTimestampMs = event.receivedTimestampMs;
        newlineIndex = pending.indexOf("\n");
      }
    }
  } catch (error) {
    gzip?.destroy();
    throw error;
  }
  pending += decoder.end();
  if (pending.length !== 0) {
    gzip?.destroy();
    throw new Error(
      `${displayPath}: closed journal lacks a final newline`
    );
  }
  if (eventCount === 0) {
    gzip?.destroy();
    throw new Error(`${displayPath}: closed journal is empty`);
  }
  if (gzip !== undefined) {
    const ended = once(gzip, "end");
    gzip.end();
    await ended;
  }
  return {
    bytes,
    gzipBytes,
    eventCount,
    firstReceivedTimestampMs,
    lastReceivedTimestampMs,
    sha256: hash.digest("hex")
  };
}

async function analyzeJournal(
  filePath,
  route,
  context,
  compression
) {
  return analyzeJournalChunks(
    createReadStream(filePath),
    filePath,
    route,
    context,
    compression
  );
}

async function analyzeCompressedJournal(filePath, route, context) {
  const compressedHash = createHash("sha256");
  let compressedBytes = 0;
  const observer = new Transform({
    transform(chunk, _encoding, callback) {
      compressedBytes += chunk.length;
      compressedHash.update(chunk);
      callback(null, chunk);
    }
  });
  const decompressed = createReadStream(filePath)
    .pipe(observer)
    .pipe(createGunzip());
  const analysis = await analyzeJournalChunks(
    decompressed,
    filePath,
    route,
    context,
    "none"
  );
  return {
    ...analysis,
    gzipBytes: compressedBytes,
    compressedBytes,
    compressedSha256: compressedHash.digest("hex")
  };
}

function metadataDifferences(metadata, route, analysis) {
  const expected = {
    schemaVersion: 1,
    venue: route.venue,
    product: route.product,
    eventType: route.eventType,
    date: route.date,
    part: route.part,
    fileName: route.fileName,
    bytes: analysis.bytes,
    eventCount: analysis.eventCount,
    firstReceivedTimestampMs: analysis.firstReceivedTimestampMs,
    lastReceivedTimestampMs: analysis.lastReceivedTimestampMs,
    sha256: analysis.sha256,
    compressionEligible: true
  };
  const differences = [];
  for (const [key, value] of Object.entries(expected)) {
    if (metadata[key] !== value) {
      differences.push(
        `${key} expected=${JSON.stringify(value)} ` +
          `actual=${JSON.stringify(metadata[key])}`
      );
    }
  }
  if (
    !Number.isSafeInteger(metadata.finalizedAtMs) ||
    metadata.finalizedAtMs < analysis.lastReceivedTimestampMs
  ) {
    differences.push("finalizedAtMs is invalid");
  }
  return differences;
}

function compressionMetadataDifferences(
  metadata,
  sourceMetadata,
  sourceMetadataContents,
  route,
  analysis
) {
  const expected = {
    schemaVersion: 1,
    recordType: "journal_compression",
    algorithm: "gzip",
    level: 6,
    sourceFileName: route.fileName,
    sourceMetadataFileName: `${route.fileName}.meta.json`,
    compressedFileName: `${route.fileName}.gz`,
    sourceBytes: analysis.bytes,
    compressedBytes: analysis.compressedBytes,
    sourceSha256: analysis.sha256,
    sourceMetadataSha256: createHash("sha256")
      .update(sourceMetadataContents)
      .digest("hex"),
    compressedSha256: analysis.compressedSha256
  };
  const differences = [];
  for (const [key, value] of Object.entries(expected)) {
    if (metadata[key] !== value) {
      differences.push(
        `${key} expected=${JSON.stringify(value)} ` +
          `actual=${JSON.stringify(metadata[key])}`
      );
    }
  }
  if (
    !Number.isSafeInteger(metadata.createdAtMs) ||
    metadata.createdAtMs < sourceMetadata.finalizedAtMs
  ) {
    differences.push("createdAtMs is invalid");
  }
  return differences;
}

async function inspectOpenPart(filePath) {
  const information = await stat(filePath);
  if (information.size === 0) {
    return { bytes: 0, hasPartialLine: false };
  }
  const handle = await open(filePath, "r");
  try {
    const lastByte = Buffer.allocUnsafe(1);
    await handle.read(lastByte, 0, 1, information.size - 1);
    return {
      bytes: information.size,
      hasPartialLine: lastByte[0] !== 0x0a
    };
  } finally {
    await handle.close();
  }
}

async function hashFile(filePath) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(filePath)) {
    bytes += chunk.length;
    hash.update(chunk);
  }
  return { bytes, sha256: hash.digest("hex") };
}

function summarizeAggregate(aggregate, compression) {
  const durationMs =
    aggregate.firstReceivedTimestampMs === null ||
    aggregate.lastReceivedTimestampMs === null
      ? null
      : Math.max(
          0,
          aggregate.lastReceivedTimestampMs -
            aggregate.firstReceivedTimestampMs
        );
  return {
    closedBytes: aggregate.closedBytes,
    events: aggregate.events,
    firstReceivedTimestampMs: aggregate.firstReceivedTimestampMs,
    lastReceivedTimestampMs: aggregate.lastReceivedTimestampMs,
    durationMs,
    eventsPerSecond:
      durationMs === null || durationMs === 0
        ? null
        : round(aggregate.events / (durationMs / 1_000)),
    eventTypes: sortedRecord(aggregate.eventTypes),
    sourceToReceiveLatency: latencySummary(aggregate.latency),
    compression:
      compression === "gzip"
        ? {
            algorithm: "gzip",
            level: 6,
            compressedBytes: aggregate.gzipBytes,
            ratio:
              aggregate.closedBytes === 0
                ? null
                : round(aggregate.gzipBytes / aggregate.closedBytes),
            spaceSavingFraction:
              aggregate.closedBytes === 0
                ? null
                : round(
                    1 - aggregate.gzipBytes / aggregate.closedBytes
                  )
          }
        : { algorithm: "none" }
  };
}

function summarizeRuns(runs, starts, ends) {
  const observed = {};
  for (const [runId, run] of [...runs].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const uniqueSequences = run.ingestSequences.uniqueSequences;
    const expectedSpan =
      run.minimumIngestSequence === null ||
      run.maximumIngestSequence === null
        ? 0
        : run.maximumIngestSequence -
          run.minimumIngestSequence +
          1;
    observed[runId] = {
      eventsInClosedParts: run.events,
      minimumIngestSequence: run.minimumIngestSequence,
      maximumIngestSequence: run.maximumIngestSequence,
      duplicateIngestSequences: run.duplicateIngestSequences,
      unobservedSequencesWithinClosedRange:
        expectedSpan - uniqueSequences,
      connectionCount: run.connectionIds.size,
      hasStartManifest: starts.has(runId),
      hasEndManifest: ends.has(runId)
    };
  }
  return observed;
}

async function auditDataset(options) {
  const startedAtMs = Date.now();
  const allPaths = await walkFiles(options.dataRoot);
  const relativePaths = new Map(
    allPaths.map((path) => [
      relative(options.dataRoot, path).split(sep).join("/"),
      path
    ])
  );
  const sourceJournalPaths = [...relativePaths.keys()]
    .filter((path) => path.endsWith(".jsonl"))
    .sort();
  const compressedJournalPaths = [...relativePaths.keys()]
    .filter((path) => path.endsWith(".jsonl.gz"))
    .sort();
  const closedPaths = [
    ...new Set([
      ...sourceJournalPaths,
      ...compressedJournalPaths.map((path) =>
        path.slice(0, -".gz".length)
      )
    ])
  ].sort();
  const metadataPaths = new Set(
    [...relativePaths.keys()].filter((path) =>
      path.endsWith(".jsonl.meta.json")
    )
  );
  const compressionMetadataPaths = new Set(
    [...relativePaths.keys()].filter((path) =>
      path.endsWith(".jsonl.gz.meta.json")
    )
  );
  const openPaths = [...relativePaths.keys()]
    .filter((path) => path.endsWith(".jsonl.open"))
    .sort();
  const manifestPaths = [...relativePaths.keys()]
    .filter((path) => runManifestPattern.test(path))
    .sort();
  const recognizedPaths = new Set([
    ...closedPaths,
    ...compressedJournalPaths,
    ...metadataPaths,
    ...compressionMetadataPaths,
    ...openPaths,
    ...manifestPaths
  ]);
  const failures = [];
  const warnings = [];
  const context = {
    total: newAggregate(),
    byVenue: {},
    byProduct: {},
    byFeedEventType: {},
    feedStatusReasons: {},
    tradeContinuity: {},
    tradeContinuityTotals: {},
    runs: new Map()
  };
  let verifiedClosedParts = 0;
  let verifiedCompressedParts = 0;
  let sourcePresentParts = 0;
  let compressedOnlyParts = 0;
  let storedCompressedBytes = 0;
  let storedSourceBytes = 0;

  for (let index = 0; index < closedPaths.length; index += 1) {
    const relativePath = closedPaths[index];
    const sourcePath = relativePaths.get(relativePath);
    const compressedRelativePath = `${relativePath}.gz`;
    const compressedPath = relativePaths.get(compressedRelativePath);
    const route = parseRoute(relativePath);
    const metadataRelativePath = `${relativePath}.meta.json`;
    const metadataPath = relativePaths.get(metadataRelativePath);
    if (
      route === null ||
      (sourcePath === undefined && compressedPath === undefined)
    ) {
      failures.push(`${relativePath}: invalid closed journal path`);
      continue;
    }
    if (metadataPath === undefined) {
      failures.push(`${relativePath}: matching metadata is missing`);
      continue;
    }
    if (index === 0 || (index + 1) % 25 === 0) {
      console.error(
        `Auditing closed journal ${index + 1}/${closedPaths.length}`
      );
    }
    try {
      const sourceMetadataContents = await readFile(metadataPath);
      const metadata = JSON.parse(
        sourceMetadataContents.toString("utf8")
      );
      const analysis =
        compressedPath === undefined
          ? await analyzeJournal(
              sourcePath,
              route,
              context,
              options.compression
            )
          : await analyzeCompressedJournal(
              compressedPath,
              route,
              context
            );
      const differences = metadataDifferences(
        metadata,
        route,
        analysis
      );
      if (differences.length > 0) {
        failures.push(
          `${relativePath}: metadata mismatch: ${differences.join("; ")}`
        );
        continue;
      }
      if (sourcePath !== undefined) {
        sourcePresentParts += 1;
        if (compressedPath !== undefined) {
          const sourceObservation = await hashFile(sourcePath);
          if (
            sourceObservation.bytes !== analysis.bytes ||
            sourceObservation.sha256 !== analysis.sha256
          ) {
            failures.push(
              `${relativePath}: source and compressed content differ`
            );
            continue;
          }
        }
      } else {
        compressedOnlyParts += 1;
      }
      if (compressedPath !== undefined) {
        const compressionMetadataPath = relativePaths.get(
          `${compressedRelativePath}.meta.json`
        );
        if (compressionMetadataPath === undefined) {
          failures.push(
            `${compressedRelativePath}: compression metadata is missing`
          );
          continue;
        }
        const compressionMetadata = JSON.parse(
          await readFile(compressionMetadataPath, "utf8")
        );
        const compressionDifferences = compressionMetadataDifferences(
          compressionMetadata,
          metadata,
          sourceMetadataContents,
          route,
          analysis
        );
        if (compressionDifferences.length > 0) {
          failures.push(
            `${compressedRelativePath}: compression metadata mismatch: ` +
              compressionDifferences.join("; ")
          );
          continue;
        }
        verifiedCompressedParts += 1;
        storedCompressedBytes += analysis.compressedBytes;
        storedSourceBytes += analysis.bytes;
      }
      verifiedClosedParts += 1;
      for (const aggregate of [
        context.total,
        context.byVenue[route.venue],
        context.byProduct[`${route.venue}|${route.product}`],
        context.byFeedEventType[
          `${route.venue}|${route.product}|${route.eventType}`
        ]
      ]) {
        aggregate.closedBytes += analysis.bytes;
        aggregate.gzipBytes += analysis.gzipBytes;
      }
    } catch (error) {
      failures.push(
        `${relativePath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  for (const metadataPath of metadataPaths) {
    const journalPath = metadataPath.slice(
      0,
      -".meta.json".length
    );
    if (
      !relativePaths.has(journalPath) &&
      !relativePaths.has(`${journalPath}.gz`)
    ) {
      failures.push(`${metadataPath}: orphan metadata`);
    }
  }
  for (const metadataPath of compressionMetadataPaths) {
    const compressedPath = metadataPath.slice(
      0,
      -".meta.json".length
    );
    if (!relativePaths.has(compressedPath)) {
      failures.push(`${metadataPath}: orphan compression metadata`);
    }
  }

  let openBytes = 0;
  let openPartsWithPartialLine = 0;
  let openPartsAlsoClosed = 0;
  for (const relativePath of openPaths) {
    const filePath = relativePaths.get(relativePath);
    if (filePath === undefined) {
      continue;
    }
    const inspection = await inspectOpenPart(filePath);
    openBytes += inspection.bytes;
    if (inspection.hasPartialLine) {
      openPartsWithPartialLine += 1;
    }
    const closedPath = relativePath.slice(0, -".open".length);
    if (
      relativePaths.has(closedPath) ||
      relativePaths.has(`${closedPath}.gz`)
    ) {
      openPartsAlsoClosed += 1;
      failures.push(
        `${relativePath}: open and closed forms both exist locally`
      );
    }
  }

  const starts = new Map();
  const ends = new Map();
  for (const relativePath of manifestPaths) {
    const match = runManifestPattern.exec(relativePath);
    const filePath = relativePaths.get(relativePath);
    if (match === null || filePath === undefined) {
      continue;
    }
    try {
      const manifest = JSON.parse(await readFile(filePath, "utf8"));
      const runId = match[1];
      const type = match[2];
      if (
        manifest.collectorRunId !== runId ||
        manifest.recordType !== `collector_run_${type}`
      ) {
        throw new Error("manifest identity does not match its path");
      }
      if (type === "start") {
        const expectedConfigHash = createHash("sha256")
          .update(canonicalStringify(manifest.config))
          .digest("hex");
        if (manifest.configHash !== expectedConfigHash) {
          throw new Error("start manifest config hash is invalid");
        }
        starts.set(runId, manifest);
      } else {
        ends.set(runId, manifest);
      }
    } catch (error) {
      failures.push(
        `${relativePath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
  for (const [runId, end] of ends) {
    const start = starts.get(runId);
    if (start === undefined) {
      warnings.push(`${runId}: end manifest has no local start manifest`);
    } else if (end.startedAtMs !== start.startedAtMs) {
      failures.push(`${runId}: start/end timestamps do not match`);
    }
  }
  for (const runId of context.runs.keys()) {
    if (!starts.has(runId)) {
      warnings.push(
        `${runId}: closed journals predate or lack a run start manifest`
      );
    }
  }
  const unexpectedFiles = [...relativePaths.keys()]
    .filter((path) => !recognizedPaths.has(path))
    .sort();
  for (const unexpectedFile of unexpectedFiles) {
    failures.push(`${unexpectedFile}: unexpected file in data root`);
  }

  const byVenue = {};
  for (const [key, aggregate] of Object.entries(context.byVenue).sort(
    ([left], [right]) => left.localeCompare(right)
  )) {
    byVenue[key] = summarizeAggregate(aggregate, options.compression);
  }
  const byProduct = {};
  for (const [key, aggregate] of Object.entries(context.byProduct).sort(
    ([left], [right]) => left.localeCompare(right)
  )) {
    byProduct[key] = summarizeAggregate(
      aggregate,
      options.compression
    );
  }
  const byFeedEventType = {};
  for (
    const [key, aggregate] of Object.entries(
      context.byFeedEventType
    ).sort(([left], [right]) => left.localeCompare(right))
  ) {
    byFeedEventType[key] = summarizeAggregate(
      aggregate,
      options.compression
    );
  }
  const startWithoutEnd = [...starts.keys()]
    .filter((runId) => !ends.has(runId))
    .sort();
  const report = {
    schemaVersion: 1,
    reportType: "stable_corridor_dataset_audit",
    generatedAtMs: Date.now(),
    auditDurationMs: Date.now() - startedAtMs,
    dataRoot: options.dataRoot,
    integrity: {
      passed: failures.length === 0,
      closedParts: closedPaths.length,
      verifiedClosedParts,
      metadataFiles: metadataPaths.size,
      compressionMetadataFiles: compressionMetadataPaths.size,
      failures
    },
    mutableDataExcluded: {
      openParts: openPaths.length,
      openBytes,
      openPartsWithPartialLine,
      openPartsAlsoClosed
    },
    total: summarizeAggregate(context.total, options.compression),
    byVenue,
    byProduct,
    byFeedEventType,
    storedCompression: {
      compressedParts: compressedJournalPaths.length,
      verifiedCompressedParts,
      sourcePresentParts,
      compressedOnlyParts,
      sourceBytes: storedSourceBytes,
      compressedBytes: storedCompressedBytes,
      ratio:
        storedSourceBytes === 0
          ? null
          : round(storedCompressedBytes / storedSourceBytes),
      spaceSavingFraction:
        storedSourceBytes === 0
          ? null
          : round(1 - storedCompressedBytes / storedSourceBytes)
    },
    feedStatusReasons: sortedRecord(context.feedStatusReasons),
    tradeContinuity: sortedRecord(context.tradeContinuity),
    tradeContinuityTotals: sortedRecord(
      context.tradeContinuityTotals
    ),
    provenance: {
      startManifests: starts.size,
      endManifests: ends.size,
      startsWithoutEnd: startWithoutEnd,
      observedRuns: summarizeRuns(context.runs, starts, ends),
      warnings: [...new Set(warnings)].sort()
    },
    unexpectedFiles,
    readiness: {
      closedJournalAnalysis:
        failures.length === 0 &&
        verifiedClosedParts > 0 &&
        context.total.events > 0,
      bookReplayInputsPresent:
        (context.total.eventTypes.book_checkpoint ?? 0) > 0 &&
        (context.total.eventTypes.book_delta ?? 0) > 0,
      liveBotCalibration: false,
      liveBotCalibrationBlockers: [
        "This audit excludes mutable open journal parts.",
        "Book-state replay and crossed-venue strategy simulation are not yet implemented.",
        "Some legacy runs predate immutable run manifests.",
        "A longer representative collection window is still required."
      ]
    }
  };
  return report;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const report = await auditDataset(options);
  const contents = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output === "-") {
    process.stdout.write(contents);
  } else {
    await mkdir(dirname(options.output), { recursive: true });
    await writeFile(options.output, contents, {
      encoding: "utf8",
      mode: 0o600
    });
    console.log(`Dataset audit written to ${options.output}`);
  }
  const summary =
    `Integrity=${report.integrity.passed ? "passed" : "failed"} ` +
      `closedParts=${report.integrity.verifiedClosedParts}/` +
      `${report.integrity.closedParts} ` +
      `events=${report.total.events} ` +
      `closedBytes=${report.total.closedBytes}`;
  if (options.output === "-") {
    console.error(summary);
  } else {
    console.log(summary);
  }
  if (!report.integrity.passed) {
    process.exitCode = 1;
  }
}

await main();
