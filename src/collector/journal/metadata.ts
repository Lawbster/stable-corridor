import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { stat } from "node:fs/promises";

import { z } from "zod";

import { canonicalJsonLine } from "../serialization.js";
import {
  normalizedEventTypeSchema,
  parseNormalizedEvent,
  type NormalizedEventType
} from "../schema/events.js";
import {
  canonicalProductSchema,
  positiveSafeIntegerSchema,
  schemaVersionSchema,
  utcEpochMillisecondsSchema,
  venueSchema
} from "../schema/primitives.js";
import { writeFileAtomic } from "../filesystem/atomic-write.js";
import type { JournalRoute } from "./path.js";

export interface JournalPartMetadata {
  readonly schemaVersion: 1;
  readonly venue: string;
  readonly product: string;
  readonly eventType: NormalizedEventType;
  readonly date: string;
  readonly part: number;
  readonly fileName: string;
  readonly bytes: number;
  readonly eventCount: number;
  readonly firstReceivedTimestampMs: number;
  readonly lastReceivedTimestampMs: number;
  readonly sha256: string;
  readonly compressionEligible: true;
  readonly finalizedAtMs: number;
}

export const journalPartMetadataSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  venue: venueSchema,
  product: canonicalProductSchema,
  eventType: normalizedEventTypeSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  part: positiveSafeIntegerSchema.max(999_999),
  fileName: z.string().min(1).max(512),
  bytes: positiveSafeIntegerSchema,
  eventCount: positiveSafeIntegerSchema,
  firstReceivedTimestampMs: utcEpochMillisecondsSchema,
  lastReceivedTimestampMs: utcEpochMillisecondsSchema,
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  compressionEligible: z.literal(true),
  finalizedAtMs: utcEpochMillisecondsSchema
});

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

export async function inspectClosedJournal(
  filePath: string,
  route: JournalRoute,
  date: string,
  part: number,
  finalizedAtMs: number
): Promise<JournalPartMetadata> {
  const lines = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Number.POSITIVE_INFINITY
  });
  let eventCount = 0;
  let firstReceivedTimestampMs: number | undefined;
  let lastReceivedTimestampMs: number | undefined;

  for await (const line of lines) {
    if (line.length === 0) {
      throw new Error(`Empty line in closed journal: ${filePath}`);
    }

    const event = parseNormalizedEvent(JSON.parse(line));
    if (
      event.venue !== route.venue ||
      event.product !== route.product ||
      event.eventType !== route.eventType
    ) {
      throw new Error(`Journal event does not match its route: ${filePath}`);
    }

    eventCount += 1;
    firstReceivedTimestampMs ??= event.receivedTimestampMs;
    lastReceivedTimestampMs = event.receivedTimestampMs;
  }

  if (
    eventCount === 0 ||
    firstReceivedTimestampMs === undefined ||
    lastReceivedTimestampMs === undefined
  ) {
    throw new Error(`Cannot finalize an empty journal: ${filePath}`);
  }

  const fileStat = await stat(filePath);
  return {
    schemaVersion: 1,
    venue: route.venue,
    product: route.product,
    eventType: route.eventType,
    date,
    part,
    fileName: filePath.split(/[\\/]/u).at(-1) ?? filePath,
    bytes: fileStat.size,
    eventCount,
    firstReceivedTimestampMs,
    lastReceivedTimestampMs,
    sha256: await sha256File(filePath),
    compressionEligible: true,
    finalizedAtMs
  };
}

export async function writeJournalPartMetadata(
  metadataPath: string,
  metadata: JournalPartMetadata
): Promise<void> {
  await writeFileAtomic(
    metadataPath,
    canonicalJsonLine(journalPartMetadataSchema.parse(metadata))
  );
}
