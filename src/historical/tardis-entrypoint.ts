import { resolve } from "node:path";

import {
  firstOfMonthDates,
  importFreeTardisHistory
} from "./tardis.js";

interface Arguments {
  readonly cacheRoot: string;
  readonly dataRoot: string;
  readonly fromMonth: string;
  readonly toMonth: string;
  readonly maxFileBytes: number;
}

function usage(): string {
  return (
    "Usage: node dist/historical/tardis-entrypoint.js " +
    "--cache-root <absolute-path> --data-root <absolute-path> " +
    "--from-month <YYYY-MM> --to-month <YYYY-MM> " +
    "[--max-file-bytes <bytes>]"
  );
}

function parseArguments(arguments_: readonly string[]): Arguments {
  let cacheRoot: string | undefined;
  let dataRoot: string | undefined;
  let fromMonth: string | undefined;
  let toMonth: string | undefined;
  let maxFileBytes = 100_000_000;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if (argument === "--cache-root" && value !== undefined) {
      cacheRoot = resolve(value);
      index += 1;
    } else if (argument === "--data-root" && value !== undefined) {
      dataRoot = resolve(value);
      index += 1;
    } else if (argument === "--from-month" && value !== undefined) {
      fromMonth = value;
      index += 1;
    } else if (argument === "--to-month" && value !== undefined) {
      toMonth = value;
      index += 1;
    } else if (
      argument === "--max-file-bytes" &&
      value !== undefined
    ) {
      maxFileBytes = Number(value);
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
  }
  if (
    cacheRoot === undefined ||
    dataRoot === undefined ||
    fromMonth === undefined ||
    toMonth === undefined
  ) {
    throw new Error(usage());
  }
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1) {
    throw new Error(`Invalid max file size: ${maxFileBytes}`);
  }
  return {
    cacheRoot,
    dataRoot,
    fromMonth,
    toMonth,
    maxFileBytes
  };
}

const arguments_ = parseArguments(process.argv.slice(2));
const result = await importFreeTardisHistory({
  cacheRoot: arguments_.cacheRoot,
  dataRoot: arguments_.dataRoot,
  dates: firstOfMonthDates(
    arguments_.fromMonth,
    arguments_.toMonth
  ),
  maxFileBytes: arguments_.maxFileBytes,
  onProgress: (message) => {
    console.error(message);
  }
});
console.log(
  JSON.stringify({
    collectorRunId: result.collectorRunId,
    dates: result.dates.length,
    downloadedFiles: result.downloadedFiles,
    cacheHits: result.cacheHits,
    importedParts: result.importedParts,
    skippedExistingParts: result.skippedExistingParts,
    importedEvents: result.importedEvents,
    sourceBytes: result.sourceBytes,
    compressedBytes: result.compressedBytes
  })
);
