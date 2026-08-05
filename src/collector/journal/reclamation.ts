import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  unlink
} from "node:fs/promises";
import { hostname } from "node:os";
import {
  basename,
  dirname,
  relative,
  resolve,
  sep
} from "node:path";
import { Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

import { z } from "zod";

import {
  syncDirectoryBestEffort,
  writeFileAtomic,
  writeFileAtomicExclusive
} from "../filesystem/atomic-write.js";
import {
  nonNegativeSafeIntegerSchema,
  positiveSafeIntegerSchema,
  schemaVersionSchema,
  utcEpochMillisecondsSchema
} from "../schema/primitives.js";
import {
  canonicalJsonLine,
  canonicalStringify
} from "../serialization.js";
import {
  journalCompressionMetadataSchema
} from "./compression.js";
import {
  journalPartMetadataSchema
} from "./metadata.js";
import { resolveContainedPath } from "./path.js";

const hashSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const relativePathSchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\\") &&
      value.split("/").every(
        (segment) =>
          segment.length > 0 &&
          segment !== "." &&
          segment !== ".."
      ),
    "Expected a normalized contained relative path"
  );

export const journalSourceReclamationEntrySchema = z.strictObject({
  sourceRelativePath: relativePathSchema,
  sourceMetadataRelativePath: relativePathSchema,
  compressedRelativePath: relativePathSchema,
  compressionMetadataRelativePath: relativePathSchema,
  sourceBytes: positiveSafeIntegerSchema,
  compressedBytes: positiveSafeIntegerSchema,
  sourceSha256: hashSchema,
  sourceMetadataSha256: hashSchema,
  compressedSha256: hashSchema,
  compressionMetadataSha256: hashSchema
});

const journalSourceReclamationPlanBodySchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  recordType: z.literal("journal_source_reclamation_plan"),
  dataRoot: z.string().min(1).max(4_096),
  createdAtMs: utcEpochMillisecondsSchema,
  entryCount: positiveSafeIntegerSchema,
  totalSourceBytes: positiveSafeIntegerSchema,
  totalCompressedBytes: positiveSafeIntegerSchema,
  entries: z.array(journalSourceReclamationEntrySchema).min(1)
});

export const journalSourceReclamationPlanSchema =
  journalSourceReclamationPlanBodySchema.extend({
    planSha256: hashSchema
  });

export const journalSourceReclamationResultSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  recordType: z.literal("journal_source_reclamation_result"),
  dataRoot: z.string().min(1).max(4_096),
  planSha256: hashSchema,
  completedAtMs: utcEpochMillisecondsSchema,
  reclaimedParts: positiveSafeIntegerSchema,
  reclaimedSourceBytes: positiveSafeIntegerSchema
});

const reclamationLockSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  recordType: z.literal("journal_source_reclamation_lock"),
  host: z.string().min(1).max(256),
  pid: positiveSafeIntegerSchema,
  createdAtMs: utcEpochMillisecondsSchema
});

export type JournalSourceReclamationEntry = z.infer<
  typeof journalSourceReclamationEntrySchema
>;
export type JournalSourceReclamationPlan = z.infer<
  typeof journalSourceReclamationPlanSchema
>;
export type JournalSourceReclamationResult = z.infer<
  typeof journalSourceReclamationResultSchema
>;

export interface PlanJournalSourceReclamationOptions {
  readonly dataRoot: string;
  readonly maxParts?: number;
  readonly now?: () => number;
  readonly onProgress?: (message: string) => void;
}

export interface WriteJournalSourceReclamationPlanOptions
  extends PlanJournalSourceReclamationOptions {
  readonly planPath: string;
}

export interface ApplyJournalSourceReclamationPlanOptions {
  readonly dataRoot: string;
  readonly planPath: string;
  readonly confirmPlanSha256: string;
  readonly now?: () => number;
  readonly onProgress?: (message: string) => void;
}

export interface ApplyJournalSourceReclamationPlanResult {
  readonly planSha256: string;
  readonly plannedParts: number;
  readonly deletedThisRunParts: number;
  readonly alreadyReclaimedParts: number;
  readonly deletedThisRunBytes: number;
  readonly reclaimedSourceBytes: number;
  readonly completionPath: string;
}

interface FileObservation {
  readonly bytes: number;
  readonly sha256: string;
}

interface CompressedObservation {
  readonly compressedBytes: number;
  readonly compressedSha256: string;
  readonly sourceBytes: number;
  readonly sourceSha256: string;
}

interface MutableCompressedObservation {
  compressedBytes: number;
  sourceBytes: number;
  readonly compressedHash: ReturnType<typeof createHash>;
  readonly sourceHash: ReturnType<typeof createHash>;
}

interface VerifiedEntry {
  readonly sourcePresent: boolean;
}

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

async function assertPathAbsent(filePath: string): Promise<void> {
  try {
    await lstat(filePath);
    throw new Error(`Unexpected mutable journal sibling: ${filePath}`);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      throw error;
    }
  }
}

async function observeFile(filePath: string): Promise<FileObservation> {
  await assertRegularFile(filePath);
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(filePath)) {
    bytes += chunk.length;
    hash.update(chunk);
  }
  return {
    bytes: positiveSafeIntegerSchema.parse(bytes),
    sha256: hash.digest("hex")
  };
}

function observingTransform(
  observation: MutableCompressedObservation,
  side: "compressed" | "source"
): Transform {
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      if (side === "compressed") {
        observation.compressedBytes += chunk.length;
        observation.compressedHash.update(chunk);
      } else {
        observation.sourceBytes += chunk.length;
        observation.sourceHash.update(chunk);
      }
      callback(null, chunk);
    }
  });
}

async function observeCompressedFile(
  compressedPath: string
): Promise<CompressedObservation> {
  await assertRegularFile(compressedPath);
  const observation: MutableCompressedObservation = {
    compressedBytes: 0,
    sourceBytes: 0,
    compressedHash: createHash("sha256"),
    sourceHash: createHash("sha256")
  };
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
  return {
    compressedBytes: positiveSafeIntegerSchema.parse(
      observation.compressedBytes
    ),
    compressedSha256: observation.compressedHash.digest("hex"),
    sourceBytes: positiveSafeIntegerSchema.parse(observation.sourceBytes),
    sourceSha256: observation.sourceHash.digest("hex")
  };
}

async function walkClosedSourceJournals(root: string): Promise<string[]> {
  try {
    const information = await lstat(root);
    if (information.isSymbolicLink() || !information.isDirectory()) {
      throw new Error(`Invalid journal directory: ${root}`);
    }
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return [];
    }
    throw error;
  }

  const output: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      output.push(...(await walkClosedSourceJournals(path)));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      output.push(path);
    } else if (entry.isSymbolicLink()) {
      throw new Error(`Symbolic links are not supported: ${path}`);
    }
  }
  return output;
}

function toRelativePath(dataRoot: string, filePath: string): string {
  const relativePath = relative(dataRoot, filePath)
    .split(sep)
    .join("/");
  return relativePathSchema.parse(relativePath);
}

function resolveRelativePath(
  dataRoot: string,
  relativePath: string
): string {
  const parsed = relativePathSchema.parse(relativePath);
  return resolveContainedPath(dataRoot, ...parsed.split("/"));
}

function companionRelativePaths(sourceRelativePath: string): {
  readonly sourceMetadataRelativePath: string;
  readonly compressedRelativePath: string;
  readonly compressionMetadataRelativePath: string;
} {
  if (
    !sourceRelativePath.startsWith("normalized/") ||
    !sourceRelativePath.endsWith(".jsonl")
  ) {
    throw new Error(
      `Invalid normalized source journal path: ${sourceRelativePath}`
    );
  }
  return {
    sourceMetadataRelativePath: `${sourceRelativePath}.meta.json`,
    compressedRelativePath: `${sourceRelativePath}.gz`,
    compressionMetadataRelativePath:
      `${sourceRelativePath}.gz.meta.json`
  };
}

function planBody(
  plan: JournalSourceReclamationPlan
): z.infer<typeof journalSourceReclamationPlanBodySchema> {
  const { planSha256: _planSha256, ...body } = plan;
  return journalSourceReclamationPlanBodySchema.parse(body);
}

function calculatePlanSha256(
  body: z.infer<typeof journalSourceReclamationPlanBodySchema>
): string {
  return createHash("sha256")
    .update(canonicalStringify(body))
    .digest("hex");
}

function assertPlanChecksum(plan: JournalSourceReclamationPlan): void {
  const expected = calculatePlanSha256(planBody(plan));
  if (plan.planSha256 !== expected) {
    throw new Error(
      `Reclamation plan checksum mismatch: expected ${expected}`
    );
  }
}

function assertEqual(
  actual: string | number,
  expected: string | number,
  label: string,
  sourcePath: string
): void {
  if (actual !== expected) {
    throw new Error(
      `${label} mismatch for ${sourcePath}: ` +
        `expected=${expected} actual=${actual}`
    );
  }
}

async function verifyEntry(
  dataRoot: string,
  entry: JournalSourceReclamationEntry,
  allowMissingSource: boolean
): Promise<VerifiedEntry> {
  const companions = companionRelativePaths(entry.sourceRelativePath);
  assertEqual(
    entry.sourceMetadataRelativePath,
    companions.sourceMetadataRelativePath,
    "Source metadata path",
    entry.sourceRelativePath
  );
  assertEqual(
    entry.compressedRelativePath,
    companions.compressedRelativePath,
    "Compressed path",
    entry.sourceRelativePath
  );
  assertEqual(
    entry.compressionMetadataRelativePath,
    companions.compressionMetadataRelativePath,
    "Compression metadata path",
    entry.sourceRelativePath
  );

  const sourcePath = resolveRelativePath(
    dataRoot,
    entry.sourceRelativePath
  );
  const sourceMetadataPath = resolveRelativePath(
    dataRoot,
    entry.sourceMetadataRelativePath
  );
  const compressedPath = resolveRelativePath(
    dataRoot,
    entry.compressedRelativePath
  );
  const compressionMetadataPath = resolveRelativePath(
    dataRoot,
    entry.compressionMetadataRelativePath
  );
  await assertPathAbsent(`${sourcePath}.open`);

  await assertRegularFile(sourceMetadataPath);
  const sourceMetadataContents = await readFile(sourceMetadataPath);
  const sourceMetadata = journalPartMetadataSchema.parse(
    JSON.parse(sourceMetadataContents.toString("utf8"))
  );
  const sourceMetadataSha256 = createHash("sha256")
    .update(sourceMetadataContents)
    .digest("hex");
  assertEqual(
    sourceMetadata.fileName,
    basename(sourcePath),
    "Source metadata filename",
    sourcePath
  );
  assertEqual(
    sourceMetadata.bytes,
    entry.sourceBytes,
    "Planned source bytes",
    sourcePath
  );
  assertEqual(
    sourceMetadata.sha256,
    entry.sourceSha256,
    "Planned source SHA-256",
    sourcePath
  );
  assertEqual(
    sourceMetadataSha256,
    entry.sourceMetadataSha256,
    "Planned source metadata SHA-256",
    sourcePath
  );

  await assertRegularFile(compressionMetadataPath);
  const compressionMetadataContents = await readFile(
    compressionMetadataPath
  );
  const compressionMetadata = journalCompressionMetadataSchema.parse(
    JSON.parse(compressionMetadataContents.toString("utf8"))
  );
  const compressionMetadataSha256 = createHash("sha256")
    .update(compressionMetadataContents)
    .digest("hex");
  assertEqual(
    compressionMetadataSha256,
    entry.compressionMetadataSha256,
    "Planned compression metadata SHA-256",
    sourcePath
  );
  assertEqual(
    compressionMetadata.sourceFileName,
    basename(sourcePath),
    "Compression source filename",
    sourcePath
  );
  assertEqual(
    compressionMetadata.sourceMetadataFileName,
    basename(sourceMetadataPath),
    "Compression source metadata filename",
    sourcePath
  );
  assertEqual(
    compressionMetadata.compressedFileName,
    basename(compressedPath),
    "Compression filename",
    sourcePath
  );
  assertEqual(
    compressionMetadata.sourceBytes,
    sourceMetadata.bytes,
    "Compression source bytes",
    sourcePath
  );
  assertEqual(
    compressionMetadata.sourceSha256,
    sourceMetadata.sha256,
    "Compression source SHA-256",
    sourcePath
  );
  assertEqual(
    compressionMetadata.sourceMetadataSha256,
    sourceMetadataSha256,
    "Compression source metadata SHA-256",
    sourcePath
  );
  if (compressionMetadata.createdAtMs < sourceMetadata.finalizedAtMs) {
    throw new Error(
      `Compression metadata predates source finalization: ${sourcePath}`
    );
  }

  const compressed = await observeCompressedFile(compressedPath);
  assertEqual(
    compressed.compressedBytes,
    compressionMetadata.compressedBytes,
    "Compressed bytes",
    sourcePath
  );
  assertEqual(
    compressed.compressedSha256,
    compressionMetadata.compressedSha256,
    "Compressed SHA-256",
    sourcePath
  );
  assertEqual(
    compressed.sourceBytes,
    sourceMetadata.bytes,
    "Decompressed source bytes",
    sourcePath
  );
  assertEqual(
    compressed.sourceSha256,
    sourceMetadata.sha256,
    "Decompressed source SHA-256",
    sourcePath
  );
  assertEqual(
    compressed.compressedBytes,
    entry.compressedBytes,
    "Planned compressed bytes",
    sourcePath
  );
  assertEqual(
    compressed.compressedSha256,
    entry.compressedSha256,
    "Planned compressed SHA-256",
    sourcePath
  );

  const sourcePresent = await regularFileExists(sourcePath);
  if (!sourcePresent) {
    if (!allowMissingSource) {
      throw new Error(`Source journal is missing: ${sourcePath}`);
    }
    return { sourcePresent: false };
  }
  const source = await observeFile(sourcePath);
  assertEqual(
    source.bytes,
    sourceMetadata.bytes,
    "Source bytes",
    sourcePath
  );
  assertEqual(
    source.sha256,
    sourceMetadata.sha256,
    "Source SHA-256",
    sourcePath
  );
  return { sourcePresent: true };
}

async function createEntry(
  dataRoot: string,
  sourcePath: string
): Promise<JournalSourceReclamationEntry> {
  const sourceRelativePath = toRelativePath(dataRoot, sourcePath);
  const companions = companionRelativePaths(sourceRelativePath);
  const sourceMetadataPath = resolveRelativePath(
    dataRoot,
    companions.sourceMetadataRelativePath
  );
  const compressedPath = resolveRelativePath(
    dataRoot,
    companions.compressedRelativePath
  );
  const compressionMetadataPath = resolveRelativePath(
    dataRoot,
    companions.compressionMetadataRelativePath
  );
  await assertRegularFile(sourcePath);
  await assertPathAbsent(`${sourcePath}.open`);
  await assertRegularFile(sourceMetadataPath);
  await assertRegularFile(compressedPath);
  await assertRegularFile(compressionMetadataPath);
  const sourceMetadataContents = await readFile(sourceMetadataPath);
  const sourceMetadata = journalPartMetadataSchema.parse(
    JSON.parse(sourceMetadataContents.toString("utf8"))
  );
  const compressionMetadataContents = await readFile(
    compressionMetadataPath
  );
  const compressionMetadata = journalCompressionMetadataSchema.parse(
    JSON.parse(compressionMetadataContents.toString("utf8"))
  );
  const entry = journalSourceReclamationEntrySchema.parse({
    sourceRelativePath,
    ...companions,
    sourceBytes: sourceMetadata.bytes,
    compressedBytes: compressionMetadata.compressedBytes,
    sourceSha256: sourceMetadata.sha256,
    sourceMetadataSha256: createHash("sha256")
      .update(sourceMetadataContents)
      .digest("hex"),
    compressedSha256: compressionMetadata.compressedSha256,
    compressionMetadataSha256: createHash("sha256")
      .update(compressionMetadataContents)
      .digest("hex")
  });
  await verifyEntry(dataRoot, entry, false);
  return entry;
}

export async function createJournalSourceReclamationPlan(
  options: PlanJournalSourceReclamationOptions
): Promise<JournalSourceReclamationPlan> {
  const dataRoot = resolveContainedPath(options.dataRoot);
  const normalizedRoot = resolveContainedPath(dataRoot, "normalized");
  const maxParts =
    options.maxParts === undefined
      ? Number.MAX_SAFE_INTEGER
      : positiveSafeIntegerSchema.parse(options.maxParts);
  const sourcePaths = (await walkClosedSourceJournals(normalizedRoot))
    .sort()
    .slice(0, maxParts);
  if (sourcePaths.length === 0) {
    throw new Error("No source-present closed journals are eligible");
  }

  const entries: JournalSourceReclamationEntry[] = [];
  for (let index = 0; index < sourcePaths.length; index += 1) {
    const sourcePath = sourcePaths[index]!;
    options.onProgress?.(
      `Verifying reclamation candidate ${index + 1}/` +
        `${sourcePaths.length}: ${sourcePath}`
    );
    entries.push(await createEntry(dataRoot, sourcePath));
  }

  const body = journalSourceReclamationPlanBodySchema.parse({
    schemaVersion: 1,
    recordType: "journal_source_reclamation_plan",
    dataRoot,
    createdAtMs: (options.now ?? Date.now)(),
    entryCount: entries.length,
    totalSourceBytes: entries.reduce(
      (total, entry) => total + entry.sourceBytes,
      0
    ),
    totalCompressedBytes: entries.reduce(
      (total, entry) => total + entry.compressedBytes,
      0
    ),
    entries
  });
  return journalSourceReclamationPlanSchema.parse({
    ...body,
    planSha256: calculatePlanSha256(body)
  });
}

async function processIsRunning(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (errorCode(error) === "ESRCH") {
      return false;
    }
    return true;
  }
}

async function acquireLock(lockPath: string): Promise<{
  readonly close: () => Promise<void>;
}> {
  await mkdir(dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(
        canonicalJsonLine(
          reclamationLockSchema.parse({
            schemaVersion: 1,
            recordType: "journal_source_reclamation_lock",
            host: hostname(),
            pid: process.pid,
            createdAtMs: Date.now()
          })
        )
      );
      await handle.sync();
      return {
        close: async () => {
          await handle.close();
          await unlink(lockPath).catch(() => undefined);
          await syncDirectoryBestEffort(dirname(lockPath));
        }
      };
    } catch (error) {
      if (errorCode(error) !== "EEXIST") {
        throw error;
      }
      const existing = reclamationLockSchema.parse(
        JSON.parse(await readFile(lockPath, "utf8"))
      );
      if (
        existing.host !== hostname() ||
        (await processIsRunning(existing.pid))
      ) {
        throw new Error(
          `Reclamation operation is already locked: ${lockPath}`
        );
      }
      await unlink(lockPath);
    }
  }
  throw new Error(`Could not acquire reclamation lock: ${lockPath}`);
}

async function withPlanLock<T>(
  planPath: string,
  operation: () => Promise<T>
): Promise<T> {
  const lock = await acquireLock(`${planPath}.lock`);
  try {
    return await operation();
  } finally {
    await lock.close();
  }
}

export async function writeJournalSourceReclamationPlan(
  options: WriteJournalSourceReclamationPlanOptions
): Promise<JournalSourceReclamationPlan> {
  const planPath = resolve(options.planPath);
  return withPlanLock(planPath, async () => {
    if (await regularFileExists(`${planPath}.applied.json`)) {
      throw new Error(
        "A completion record already exists; use a new plan path"
      );
    }
    if (await regularFileExists(planPath)) {
      await assertRegularFile(planPath);
    }
    const plan = await createJournalSourceReclamationPlan(options);
    await writeFileAtomic(planPath, canonicalJsonLine(plan));
    return plan;
  });
}

async function readPlan(
  planPath: string
): Promise<JournalSourceReclamationPlan> {
  await assertRegularFile(planPath);
  const plan = journalSourceReclamationPlanSchema.parse(
    JSON.parse(await readFile(planPath, "utf8"))
  );
  assertPlanChecksum(plan);
  assertEqual(plan.entryCount, plan.entries.length, "Plan entry count", planPath);
  assertEqual(
    plan.totalSourceBytes,
    plan.entries.reduce(
      (total, entry) => total + entry.sourceBytes,
      0
    ),
    "Plan source byte total",
    planPath
  );
  assertEqual(
    plan.totalCompressedBytes,
    plan.entries.reduce(
      (total, entry) => total + entry.compressedBytes,
      0
    ),
    "Plan compressed byte total",
    planPath
  );
  const sortedPaths = plan.entries
    .map((entry) => entry.sourceRelativePath)
    .sort();
  const actualPaths = plan.entries.map(
    (entry) => entry.sourceRelativePath
  );
  if (
    new Set(actualPaths).size !== actualPaths.length ||
    actualPaths.some((path, index) => path !== sortedPaths[index])
  ) {
    throw new Error(
      `Reclamation plan paths are duplicated or not sorted: ${planPath}`
    );
  }
  return plan;
}

async function writeCompletion(
  completionPath: string,
  result: JournalSourceReclamationResult
): Promise<void> {
  try {
    await writeFileAtomicExclusive(
      completionPath,
      canonicalJsonLine(result)
    );
  } catch (error) {
    if (errorCode(error) !== "EEXIST") {
      throw error;
    }
    await assertRegularFile(completionPath);
    const existing = journalSourceReclamationResultSchema.parse(
      JSON.parse(await readFile(completionPath, "utf8"))
    );
    for (const key of [
      "dataRoot",
      "planSha256",
      "reclaimedParts",
      "reclaimedSourceBytes"
    ] as const) {
      assertEqual(
        existing[key],
        result[key],
        `Existing completion ${key}`,
        completionPath
      );
    }
  }
}

async function assertCompatibleCompletion(
  completionPath: string,
  plan: JournalSourceReclamationPlan
): Promise<void> {
  if (!(await regularFileExists(completionPath))) {
    return;
  }
  const existing = journalSourceReclamationResultSchema.parse(
    JSON.parse(await readFile(completionPath, "utf8"))
  );
  for (const [label, actual, expected] of [
    ["data root", existing.dataRoot, plan.dataRoot],
    ["plan checksum", existing.planSha256, plan.planSha256],
    ["part count", existing.reclaimedParts, plan.entryCount],
    [
      "source byte total",
      existing.reclaimedSourceBytes,
      plan.totalSourceBytes
    ]
  ] as const) {
    assertEqual(
      actual,
      expected,
      `Existing completion ${label}`,
      completionPath
    );
  }
}

export async function applyJournalSourceReclamationPlan(
  options: ApplyJournalSourceReclamationPlanOptions
): Promise<ApplyJournalSourceReclamationPlanResult> {
  const dataRoot = resolveContainedPath(options.dataRoot);
  const planPath = resolve(options.planPath);
  return withPlanLock(planPath, async () => {
    const plan = await readPlan(planPath);
    assertEqual(plan.dataRoot, dataRoot, "Plan data root", planPath);
    assertEqual(
      options.confirmPlanSha256,
      plan.planSha256,
      "Confirmation checksum",
      planPath
    );
    const completionPath = `${planPath}.applied.json`;
    await assertCompatibleCompletion(completionPath, plan);

    for (let index = 0; index < plan.entries.length; index += 1) {
      const entry = plan.entries[index]!;
      options.onProgress?.(
        `Preflight verification ${index + 1}/${plan.entries.length}: ` +
          entry.sourceRelativePath
      );
      await verifyEntry(dataRoot, entry, true);
    }

    let deletedThisRunParts = 0;
    let alreadyReclaimedParts = 0;
    let deletedThisRunBytes = 0;
    for (let index = 0; index < plan.entries.length; index += 1) {
      const entry = plan.entries[index]!;
      options.onProgress?.(
        `Immediate verification ${index + 1}/${plan.entries.length}: ` +
          entry.sourceRelativePath
      );
      const verified = await verifyEntry(dataRoot, entry, true);
      if (!verified.sourcePresent) {
        alreadyReclaimedParts += 1;
        continue;
      }
      const sourcePath = resolveRelativePath(
        dataRoot,
        entry.sourceRelativePath
      );
      await unlink(sourcePath);
      await syncDirectoryBestEffort(dirname(sourcePath));
      await assertPathAbsent(sourcePath);
      deletedThisRunParts += 1;
      deletedThisRunBytes += entry.sourceBytes;
    }

    await writeCompletion(
      completionPath,
      journalSourceReclamationResultSchema.parse({
        schemaVersion: 1,
        recordType: "journal_source_reclamation_result",
        dataRoot,
        planSha256: plan.planSha256,
        completedAtMs: (options.now ?? Date.now)(),
        reclaimedParts: plan.entryCount,
        reclaimedSourceBytes: plan.totalSourceBytes
      })
    );
    return {
      planSha256: plan.planSha256,
      plannedParts: plan.entryCount,
      deletedThisRunParts,
      alreadyReclaimedParts,
      deletedThisRunBytes: nonNegativeSafeIntegerSchema.parse(
        deletedThisRunBytes
      ),
      reclaimedSourceBytes: plan.totalSourceBytes,
      completionPath
    };
  });
}
