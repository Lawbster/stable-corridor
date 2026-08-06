import { resolve } from "node:path";

import { writeFileAtomic } from "../collector/filesystem/atomic-write.js";
import { canonicalJsonLine } from "../collector/serialization.js";
import {
  scanTradeThrough
} from "../opportunity/trade-through-scan.js";
import {
  discoverClosedJournalParts,
  readMergedJournalParts
} from "./journal-reader.js";

interface Arguments {
  readonly dataRoot: string;
  readonly outputPath: string;
  readonly collectorRunId: string;
  readonly targetSampleIntervalMs: number;
}

function parseArguments(arguments_: readonly string[]): Arguments {
  let dataRoot: string | undefined;
  let outputPath: string | undefined;
  let collectorRunId: string | undefined;
  let targetSampleIntervalMs = 0;
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
      argument === "--target-sample-interval-ms" &&
      value !== undefined
    ) {
      targetSampleIntervalMs = Number(value);
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
  }
  if (
    dataRoot === undefined ||
    outputPath === undefined ||
    collectorRunId === undefined
  ) {
    throw new Error(
      "Usage: node dist/replay/trade-through-scan-entrypoint.js " +
        "--data-root <absolute-path> --output <absolute-path> " +
        "--run-id <collector-run-id> " +
        "[--target-sample-interval-ms <milliseconds>]"
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
    targetSampleIntervalMs
  };
}

const arguments_ = parseArguments(process.argv.slice(2));
const parts = await discoverClosedJournalParts({
  dataRoot: arguments_.dataRoot,
  eventTypes: new Set(["book_checkpoint", "trade"]),
  preferRepresentation: "gzip"
});
const report = await scanTradeThrough(
  readMergedJournalParts(parts),
  {
    collectorRunId: arguments_.collectorRunId,
    targetSampleIntervalMs: arguments_.targetSampleIntervalMs
  }
);
await writeFileAtomic(arguments_.outputPath, canonicalJsonLine(report));
console.log(
  JSON.stringify({
    outputPath: arguments_.outputPath,
    journalParts: parts.length,
    gzipParts: parts.filter(
      (part) => part.representation === "gzip"
    ).length,
    classification: report.economicBearing.classification,
    signals: report.signals.total,
    fullOrderWithin60Seconds:
      report.horizons["60000ms"]?.fullOrder ?? 0
  })
);
