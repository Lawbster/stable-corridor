import { z } from "zod";

import {
  canonicalProductSchema,
  nonNegativeSafeIntegerSchema,
  schemaVersionSchema,
  utcEpochMillisecondsSchema,
  venueSchema,
  venueSequenceSchema
} from "../collector/schema/primitives.js";

const nonNegativeMetricSchema = z.number().finite().nonnegative();

export const feedHealthSchema = z.strictObject({
  venue: venueSchema,
  product: canonicalProductSchema,
  connectionState: z.enum([
    "connecting",
    "healthy",
    "stale",
    "gapped",
    "recovering",
    "stopped"
  ]),
  lastReceivedAtMs: utcEpochMillisecondsSchema.nullable(),
  lastSourceAtMs: utcEpochMillisecondsSchema.nullable(),
  receiveAgeMs: nonNegativeMetricSchema.nullable(),
  venueSequence: venueSequenceSchema,
  gapCount: nonNegativeSafeIntegerSchema,
  reconnectCount: nonNegativeSafeIntegerSchema,
  crossedBookCount: nonNegativeSafeIntegerSchema,
  eligibleForResearch: z.boolean()
});

export const collectorHealthSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  processName: z.literal("stable-corridor-collector"),
  status: z.enum(["healthy", "degraded", "unhealthy", "stopping"]),
  reasonCodes: z.array(z.string().min(1).max(128)).max(128),
  commitSha: z.string().min(7).max(64).nullable(),
  configHash: z.string().min(1).max(256),
  startedAtMs: utcEpochMillisecondsSchema,
  publishedAtMs: utcEpochMillisecondsSchema,
  eventLoopLagMs: nonNegativeMetricSchema,
  memoryRssBytes: nonNegativeSafeIntegerSchema,
  dataRootBytes: nonNegativeSafeIntegerSchema,
  diskFreeBytes: nonNegativeSafeIntegerSchema,
  journalLastWriteAtMs: utcEpochMillisecondsSchema.nullable(),
  journalErrorCount: nonNegativeSafeIntegerSchema,
  feeds: z.array(feedHealthSchema).max(1_000)
});

export type CollectorHealth = z.infer<typeof collectorHealthSchema>;
