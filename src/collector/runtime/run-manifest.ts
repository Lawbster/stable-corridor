import { z } from "zod";

import {
  collectorConfigSchema,
  type CollectorConfig
} from "../config.js";
import {
  collectorRunIdSchema,
  nonNegativeSafeIntegerSchema,
  schemaVersionSchema,
  utcEpochMillisecondsSchema
} from "../schema/primitives.js";
import { canonicalJsonLine } from "../serialization.js";
import { writeFileAtomicExclusive } from "../filesystem/atomic-write.js";
import { resolveContainedPath } from "../journal/path.js";

const commitShaSchema = z
  .string()
  .regex(/^[0-9a-f]{7,64}$/iu)
  .nullable();
const hashSchema = z.string().regex(/^[0-9a-f]{64}$/u);

export const collectorRunStartManifestSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  recordType: z.literal("collector_run_start"),
  collectorRunId: collectorRunIdSchema,
  processName: z.literal("stable-corridor-collector"),
  commitSha: commitShaSchema,
  configHash: hashSchema,
  config: collectorConfigSchema,
  startedAtMs: utcEpochMillisecondsSchema,
  nodeVersion: z.string().min(1).max(64),
  platform: z.string().min(1).max(64),
  architecture: z.string().min(1).max(64)
});

export const collectorRunEndManifestSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  recordType: z.literal("collector_run_end"),
  collectorRunId: collectorRunIdSchema,
  startedAtMs: utcEpochMillisecondsSchema,
  stoppedAtMs: utcEpochMillisecondsSchema,
  stopReason: z.string().min(1).max(512),
  exitCode: nonNegativeSafeIntegerSchema.max(255),
  journalErrorCount: nonNegativeSafeIntegerSchema
});

export type CollectorRunStartManifest = z.infer<
  typeof collectorRunStartManifestSchema
>;
export type CollectorRunEndManifest = z.infer<
  typeof collectorRunEndManifestSchema
>;

interface CollectorRunStartInput {
  readonly dataRoot: string;
  readonly collectorRunId: string;
  readonly commitSha: string | null;
  readonly configHash: string;
  readonly config: CollectorConfig;
  readonly startedAtMs: number;
}

interface CollectorRunEndInput {
  readonly dataRoot: string;
  readonly collectorRunId: string;
  readonly startedAtMs: number;
  readonly stoppedAtMs: number;
  readonly stopReason: string;
  readonly exitCode: number;
  readonly journalErrorCount: number;
}

function manifestPath(
  dataRoot: string,
  collectorRunId: string,
  fileName: "start.json" | "end.json"
): string {
  const validatedRunId = collectorRunIdSchema.parse(collectorRunId);
  return resolveContainedPath(
    dataRoot,
    "runs",
    validatedRunId,
    fileName
  );
}

export async function writeCollectorRunStartManifest(
  input: CollectorRunStartInput
): Promise<CollectorRunStartManifest> {
  const manifest = collectorRunStartManifestSchema.parse({
    schemaVersion: 1,
    recordType: "collector_run_start",
    collectorRunId: input.collectorRunId,
    processName: input.config.processName,
    commitSha: input.commitSha,
    configHash: input.configHash,
    config: input.config,
    startedAtMs: input.startedAtMs,
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch
  });
  await writeFileAtomicExclusive(
    manifestPath(input.dataRoot, input.collectorRunId, "start.json"),
    canonicalJsonLine(manifest)
  );
  return manifest;
}

export async function writeCollectorRunEndManifest(
  input: CollectorRunEndInput
): Promise<CollectorRunEndManifest> {
  const manifest = collectorRunEndManifestSchema.parse({
    schemaVersion: 1,
    recordType: "collector_run_end",
    collectorRunId: input.collectorRunId,
    startedAtMs: input.startedAtMs,
    stoppedAtMs: input.stoppedAtMs,
    stopReason: input.stopReason,
    exitCode: input.exitCode,
    journalErrorCount: input.journalErrorCount
  });
  await writeFileAtomicExclusive(
    manifestPath(input.dataRoot, input.collectorRunId, "end.json"),
    canonicalJsonLine(manifest)
  );
  return manifest;
}
