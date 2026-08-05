import { createHash, randomUUID } from "node:crypto";
import {
  createReadStream,
  createWriteStream
} from "node:fs";
import {
  lstat,
  open,
  readFile,
  readdir,
  stat,
  unlink
} from "node:fs/promises";
import {
  basename,
  dirname,
  join,
  resolve
} from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform, Writable } from "node:stream";
import { createGunzip, createGzip } from "node:zlib";

import { z } from "zod";

import {
  publishTemporaryFileAtomicExclusive,
  writeFileAtomicExclusive
} from "../filesystem/atomic-write.js";
import {
  journalPartMetadataSchema,
  type JournalPartMetadata
} from "./metadata.js";
import { resolveContainedPath } from "./path.js";
import {
  canonicalJsonLine
} from "../serialization.js";
import {
  nonNegativeSafeIntegerSchema,
  positiveSafeIntegerSchema,
  schemaVersionSchema,
  utcEpochMillisecondsSchema
} from "../schema/primitives.js";

const hashSchema = z.string().regex(/^[0-9a-f]{64}$/u);

export const journalCompressionMetadataSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  recordType: z.literal("journal_compression"),
  algorithm: z.literal("gzip"),
  level: z.literal(6),
  sourceFileName: z.string().min(1).max(512),
  sourceMetadataFileName: z.string().min(1).max(512),
  compressedFileName: z.string().min(1).max(512),
  sourceBytes: positiveSafeIntegerSchema,
  compressedBytes: positiveSafeIntegerSchema,
  sourceSha256: hashSchema,
  sourceMetadataSha256: hashSchema,
  compressedSha256: hashSchema,
  createdAtMs: utcEpochMillisecondsSchema
});

export type JournalCompressionMetadata = z.infer<
  typeof journalCompressionMetadataSchema
>;

export interface CompressClosedJournalsOptions {
  readonly dataRoot: string;
  readonly maxParts?: number;
  readonly now?: () => number;
  readonly onProgress?: (message: string) => void;
}

export interface CompressClosedJournalsResult {
  readonly eligibleParts: number;
  readonly compressedParts: number;
  readonly verifiedExistingParts: number;
  readonly sourceBytes: number;
  readonly compressedBytes: number;
}

interface FileObservation {
  readonly sourceBytes: number;
  readonly compressedBytes: number;
  readonly sourceSha256: string;
  readonly compressedSha256: string;
}

interface MutableObservation {
  sourceBytes: number;
  compressedBytes: number;
  readonly sourceHash: ReturnType<typeof createHash>;
  readonly compressedHash: ReturnType<typeof createHash>;
}

function observingTransform(
  observation: MutableObservation,
  side: "source" | "compressed"
): Transform {
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      if (side === "source") {
        observation.sourceBytes += chunk.length;
        observation.sourceHash.update(chunk);
      } else {
        observation.compressedBytes += chunk.length;
        observation.compressedHash.update(chunk);
      }
      callback(null, chunk);
    }
  });
}

function newObservation(): MutableObservation {
  return {
    sourceBytes: 0,
    compressedBytes: 0,
    sourceHash: createHash("sha256"),
    compressedHash: createHash("sha256")
  };
}

function finalizeObservation(
  observation: MutableObservation
): FileObservation {
  return {
    sourceBytes: observation.sourceBytes,
    compressedBytes: observation.compressedBytes,
    sourceSha256: observation.sourceHash.digest("hex"),
    compressedSha256: observation.compressedHash.digest("hex")
  };
}

async function walkClosedJournals(root: string): Promise<string[]> {
  try {
    const information = await lstat(root);
    if (information.isSymbolicLink() || !information.isDirectory()) {
      throw new Error(`Invalid journal directory: ${root}`);
    }
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }

  const entries = await readdir(root, { withFileTypes: true });

  const output: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      output.push(...(await walkClosedJournals(path)));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      output.push(path);
    } else if (entry.isSymbolicLink()) {
      throw new Error(`Symbolic links are not supported: ${path}`);
    }
  }
  return output;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const information = await lstat(filePath);
    return information.isFile() && !information.isSymbolicLink();
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

async function inspectCompressedFile(
  compressedPath: string
): Promise<FileObservation> {
  const observation = newObservation();
  await pipeline(
    createReadStream(compressedPath),
    observingTransform(observation, "compressed"),
    createGunzip(),
    observingTransform(observation, "source"),
    new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      }
    })
  );
  return finalizeObservation(observation);
}

function assertMatchesSource(
  sourcePath: string,
  sourceMetadata: JournalPartMetadata,
  observation: FileObservation
): void {
  if (
    observation.sourceBytes !== sourceMetadata.bytes ||
    observation.sourceSha256 !== sourceMetadata.sha256
  ) {
    throw new Error(
      `Compressed content does not match source metadata: ${sourcePath}`
    );
  }
}

function compressionMetadata(
  sourcePath: string,
  sourceMetadataPath: string,
  compressedPath: string,
  sourceMetadata: JournalPartMetadata,
  sourceMetadataSha256: string,
  observation: FileObservation,
  createdAtMs: number
): JournalCompressionMetadata {
  assertMatchesSource(sourcePath, sourceMetadata, observation);
  if (createdAtMs < sourceMetadata.finalizedAtMs) {
    throw new Error(
      `Compression time predates source finalization: ${sourcePath}`
    );
  }
  return journalCompressionMetadataSchema.parse({
    schemaVersion: 1,
    recordType: "journal_compression",
    algorithm: "gzip",
    level: 6,
    sourceFileName: basename(sourcePath),
    sourceMetadataFileName: basename(sourceMetadataPath),
    compressedFileName: basename(compressedPath),
    sourceBytes: observation.sourceBytes,
    compressedBytes: observation.compressedBytes,
    sourceSha256: observation.sourceSha256,
    sourceMetadataSha256,
    compressedSha256: observation.compressedSha256,
    createdAtMs
  });
}

function assertCompressionMetadataMatches(
  expected: JournalCompressionMetadata,
  actual: JournalCompressionMetadata
): void {
  for (const key of [
    "algorithm",
    "level",
    "sourceFileName",
    "sourceMetadataFileName",
    "compressedFileName",
    "sourceBytes",
    "compressedBytes",
    "sourceSha256",
    "sourceMetadataSha256",
    "compressedSha256"
  ] as const) {
    if (actual[key] !== expected[key]) {
      throw new Error(`Compression metadata mismatch at ${key}`);
    }
  }
}

async function compressOne(
  sourcePath: string,
  now: () => number
): Promise<"compressed" | "verified"> {
  const sourceMetadataPath = `${sourcePath}.meta.json`;
  const compressedPath = `${sourcePath}.gz`;
  const compressedMetadataPath = `${compressedPath}.meta.json`;
  const sourceMetadataContents = await readFile(sourceMetadataPath);
  const sourceMetadata = journalPartMetadataSchema.parse(
    JSON.parse(sourceMetadataContents.toString("utf8"))
  );
  if (sourceMetadata.fileName !== basename(sourcePath)) {
    throw new Error(`Source metadata filename mismatch: ${sourcePath}`);
  }
  const sourceInformation = await stat(sourcePath);
  if (sourceInformation.size !== sourceMetadata.bytes) {
    throw new Error(`Source byte count mismatch: ${sourcePath}`);
  }
  const sourceMetadataSha256 = createHash("sha256")
    .update(sourceMetadataContents)
    .digest("hex");

  let compressedExists = false;
  try {
    const information = await lstat(compressedPath);
    if (!information.isFile() || information.isSymbolicLink()) {
      throw new Error(`Invalid compressed path: ${compressedPath}`);
    }
    compressedExists = true;
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }

  if (!compressedExists) {
    try {
      await stat(compressedMetadataPath);
      throw new Error(
        `Compression metadata exists without data: ${compressedPath}`
      );
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error;
      }
    }

    const temporaryPath = join(
      dirname(compressedPath),
      `.${basename(compressedPath)}.${process.pid}.${randomUUID()}.tmp`
    );
    const observation = newObservation();
    try {
      await pipeline(
        createReadStream(sourcePath),
        observingTransform(observation, "source"),
        createGzip({ level: 6 }),
        observingTransform(observation, "compressed"),
        createWriteStream(temporaryPath, {
          flags: "wx",
          mode: 0o600
        })
      );
      const temporaryHandle = await open(temporaryPath, "r+");
      try {
        await temporaryHandle.sync();
      } finally {
        await temporaryHandle.close();
      }
      const written = finalizeObservation(observation);
      assertMatchesSource(sourcePath, sourceMetadata, written);
      await publishTemporaryFileAtomicExclusive(
        temporaryPath,
        compressedPath
      );
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  const verified = await inspectCompressedFile(compressedPath);
  const expectedMetadata = compressionMetadata(
    sourcePath,
    sourceMetadataPath,
    compressedPath,
    sourceMetadata,
    sourceMetadataSha256,
    verified,
    now()
  );
  try {
    const existing = journalCompressionMetadataSchema.parse(
      JSON.parse(await readFile(compressedMetadataPath, "utf8"))
    );
    assertCompressionMetadataMatches(expectedMetadata, existing);
    if (existing.createdAtMs < sourceMetadata.finalizedAtMs) {
      throw new Error(
        `Compression metadata predates source finalization: ${compressedPath}`
      );
    }
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      await writeFileAtomicExclusive(
        compressedMetadataPath,
        canonicalJsonLine(expectedMetadata)
      );
    } else {
      throw error;
    }
  }
  return compressedExists ? "verified" : "compressed";
}

export async function compressClosedJournals(
  options: CompressClosedJournalsOptions
): Promise<CompressClosedJournalsResult> {
  const dataRoot = resolveContainedPath(options.dataRoot);
  const normalizedRoot = resolveContainedPath(dataRoot, "normalized");
  const now = options.now ?? Date.now;
  const maxParts =
    options.maxParts === undefined
      ? Number.MAX_SAFE_INTEGER
      : positiveSafeIntegerSchema.parse(options.maxParts);
  const paths = (await walkClosedJournals(normalizedRoot)).sort();
  const prioritized = await Promise.all(
    paths.map(async (path) => ({
      path,
      compressed: await fileExists(`${path}.gz`)
    }))
  );
  prioritized.sort(
    (left, right) =>
      Number(left.compressed) - Number(right.compressed) ||
      left.path.localeCompare(right.path)
  );
  const selected = prioritized
    .slice(0, maxParts)
    .map((entry) => entry.path);
  let compressedParts = 0;
  let verifiedExistingParts = 0;
  let sourceBytes = 0;
  let compressedBytes = 0;

  for (let index = 0; index < selected.length; index += 1) {
    const path = resolve(selected[index]!);
    resolveContainedPath(dataRoot, path);
    options.onProgress?.(
      `Compressing journal ${index + 1}/${selected.length}: ${path}`
    );
    const result = await compressOne(path, now);
    if (result === "compressed") {
      compressedParts += 1;
    } else {
      verifiedExistingParts += 1;
    }
    sourceBytes += (await stat(path)).size;
    compressedBytes += (await stat(`${path}.gz`)).size;
  }

  return {
    eligibleParts: paths.length,
    compressedParts,
    verifiedExistingParts,
    sourceBytes: nonNegativeSafeIntegerSchema.parse(sourceBytes),
    compressedBytes: nonNegativeSafeIntegerSchema.parse(compressedBytes)
  };
}
