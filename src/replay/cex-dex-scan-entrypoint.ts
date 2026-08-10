import { resolve } from "node:path";

import { writeFileAtomic } from "../collector/filesystem/atomic-write.js";
import { canonicalJsonLine } from "../collector/serialization.js";
import { scanCoinbaseJupiterQuotes } from "../opportunity/cex-dex-scan.js";
import {
  discoverClosedJournalParts,
  readMergedJournalParts,
  type JournalRepresentation
} from "./journal-reader.js";

interface Arguments {
  readonly dataRoot: string;
  readonly outputPath: string;
  readonly collectorRunId: string;
  readonly coinbaseFeeBps: number;
  readonly modeledNetworkFeeUsdc: number;
  readonly executionBufferBps: number;
  readonly decisionThresholdBps: number;
  readonly persistenceHorizonMs: number;
  readonly preferRepresentation: JournalRepresentation;
}

function usage(): string {
  return (
    "Usage: node dist/replay/cex-dex-scan-entrypoint.js " +
    "--data-root <absolute-path> --output <absolute-path> " +
    "--run-id <collector-run-id> [--coinbase-fee-bps <bps>] " +
    "[--network-fee-usdc <amount>] [--execution-buffer-bps <bps>] " +
    "[--decision-threshold-bps <bps>] " +
    "[--persistence-horizon-ms <milliseconds>] [--prefer-source]"
  );
}

function parseArguments(arguments_: readonly string[]): Arguments {
  let dataRoot: string | undefined;
  let outputPath: string | undefined;
  let collectorRunId: string | undefined;
  let coinbaseFeeBps = 0.1;
  let modeledNetworkFeeUsdc = 0.01;
  let executionBufferBps = 2;
  let decisionThresholdBps = 3;
  let persistenceHorizonMs = 2_000;
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
      argument === "--coinbase-fee-bps" &&
      value !== undefined
    ) {
      coinbaseFeeBps = Number(value);
      index += 1;
    } else if (
      argument === "--network-fee-usdc" &&
      value !== undefined
    ) {
      modeledNetworkFeeUsdc = Number(value);
      index += 1;
    } else if (
      argument === "--execution-buffer-bps" &&
      value !== undefined
    ) {
      executionBufferBps = Number(value);
      index += 1;
    } else if (
      argument === "--decision-threshold-bps" &&
      value !== undefined
    ) {
      decisionThresholdBps = Number(value);
      index += 1;
    } else if (
      argument === "--persistence-horizon-ms" &&
      value !== undefined
    ) {
      persistenceHorizonMs = Number(value);
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
  if (
    !Number.isSafeInteger(persistenceHorizonMs) ||
    persistenceHorizonMs < 1
  ) {
    throw new Error(
      `Invalid persistence horizon: ${persistenceHorizonMs}`
    );
  }
  return {
    dataRoot,
    outputPath,
    collectorRunId,
    coinbaseFeeBps,
    modeledNetworkFeeUsdc,
    executionBufferBps,
    decisionThresholdBps,
    persistenceHorizonMs,
    preferRepresentation
  };
}

const arguments_ = parseArguments(process.argv.slice(2));
const parts = await discoverClosedJournalParts({
  dataRoot: arguments_.dataRoot,
  eventTypes: new Set([
    "book_checkpoint",
    "book_delta",
    "feed_status",
    "dex_quote",
    "cex_dex_probe"
  ]),
  preferRepresentation: arguments_.preferRepresentation
});
const report = await scanCoinbaseJupiterQuotes(
  readMergedJournalParts(parts, {
    collectorRunId: arguments_.collectorRunId
  }),
  {
    collectorRunId: arguments_.collectorRunId,
    coinbaseFeeBps: arguments_.coinbaseFeeBps,
    modeledNetworkFeeUsdc: arguments_.modeledNetworkFeeUsdc,
    executionBufferBps: arguments_.executionBufferBps,
    decisionThresholdBps: arguments_.decisionThresholdBps,
    persistenceHorizonMs: arguments_.persistenceHorizonMs
  }
);
await writeFileAtomic(arguments_.outputPath, canonicalJsonLine(report));
console.log(
  JSON.stringify({
    outputPath: arguments_.outputPath,
    journalParts: parts.length,
    classification: report.economicBearing.classification,
    totalJupiterQuotes: report.observations.totalJupiterQuotes,
    eligibleComparisons: report.observations.eligibleComparisons,
    sampledPersistence: report.sampledPersistence
  })
);
