import { resolve } from "node:path";

import { writeFileAtomic } from "../collector/filesystem/atomic-write.js";
import { canonicalJsonLine } from "../collector/serialization.js";
import {
  scanCorridorCheckpoints
} from "../opportunity/checkpoint-scan.js";
import {
  discoverClosedJournalParts,
  readMergedJournalParts,
  type JournalRepresentation
} from "./journal-reader.js";

interface Arguments {
  readonly dataRoot: string;
  readonly outputPath: string;
  readonly collectorRunId: string;
  readonly freshnessMs: number;
  readonly maxReferenceDispersionBps: number;
  readonly targetSampleIntervalMs: number;
  readonly preferRepresentation: JournalRepresentation;
}

function usage(): string {
  return (
    "Usage: node dist/replay/checkpoint-scan-entrypoint.js " +
    "--data-root <absolute-path> --output <absolute-path> " +
    "--run-id <collector-run-id> [--freshness-ms <milliseconds>] " +
    "[--max-reference-dispersion-bps <bps>] [--prefer-source]"
    + " [--target-sample-interval-ms <milliseconds>]"
  );
}

function parseArguments(arguments_: readonly string[]): Arguments {
  let dataRoot: string | undefined;
  let outputPath: string | undefined;
  let collectorRunId: string | undefined;
  let freshnessMs = 90_000;
  let maxReferenceDispersionBps = 2;
  let targetSampleIntervalMs = 0;
  let preferRepresentation: JournalRepresentation = "gzip";

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if (argument === "--data-root" && value !== undefined) {
      dataRoot = resolve(value);
      index += 1;
    } else if (argument === "--output" && value !== undefined) {
      outputPath = resolve(value);
      index += 1;
    } else if (argument === "--run-id" && value !== undefined) {
      collectorRunId = value;
      index += 1;
    } else if (
      argument === "--freshness-ms" &&
      value !== undefined
    ) {
      freshnessMs = Number(value);
      index += 1;
    } else if (
      argument === "--max-reference-dispersion-bps" &&
      value !== undefined
    ) {
      maxReferenceDispersionBps = Number(value);
      index += 1;
    } else if (
      argument === "--target-sample-interval-ms" &&
      value !== undefined
    ) {
      targetSampleIntervalMs = Number(value);
      index += 1;
    } else if (argument === "--prefer-source") {
      preferRepresentation = "source";
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
  }
  if (
    dataRoot === undefined ||
    outputPath === undefined ||
    collectorRunId === undefined
  ) {
    throw new Error(usage());
  }
  if (!Number.isSafeInteger(freshnessMs) || freshnessMs < 1) {
    throw new Error(`Invalid freshness: ${freshnessMs}`);
  }
  if (
    !Number.isFinite(maxReferenceDispersionBps) ||
    maxReferenceDispersionBps < 0
  ) {
    throw new Error(
      `Invalid reference dispersion: ${maxReferenceDispersionBps}`
    );
  }
  if (
    !Number.isSafeInteger(targetSampleIntervalMs) ||
    targetSampleIntervalMs < 0
  ) {
    throw new Error(
      `Invalid target sample interval: ${targetSampleIntervalMs}`
    );
  }
  return {
    dataRoot,
    outputPath,
    collectorRunId,
    freshnessMs,
    maxReferenceDispersionBps,
    targetSampleIntervalMs,
    preferRepresentation
  };
}

const arguments_ = parseArguments(process.argv.slice(2));
const parts = await discoverClosedJournalParts({
  dataRoot: arguments_.dataRoot,
  eventTypes: new Set(["book_checkpoint"]),
  preferRepresentation: arguments_.preferRepresentation
});
const report = await scanCorridorCheckpoints(
  readMergedJournalParts(parts, {
    collectorRunId: arguments_.collectorRunId
  }),
  {
    collectorRunId: arguments_.collectorRunId,
    freshnessMs: arguments_.freshnessMs,
    maxReferenceDispersionBps:
      arguments_.maxReferenceDispersionBps,
    targetSampleIntervalMs: arguments_.targetSampleIntervalMs
  }
);
await writeFileAtomic(arguments_.outputPath, canonicalJsonLine(report));
console.log(
  JSON.stringify({
    outputPath: arguments_.outputPath,
    journalParts: parts.length,
    sourceParts: parts.filter(
      (part) => part.representation === "source"
    ).length,
    gzipParts: parts.filter(
      (part) => part.representation === "gzip"
    ).length,
    classification: report.economicBearing.classification,
    eligibleTargetSamples:
      report.observations.eligibleTargetSamples,
    highConfidenceSamples:
      report.observations.highConfidenceSamples
  })
);
