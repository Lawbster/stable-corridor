import { resolve } from "node:path";

import {
  compressClosedJournals
} from "./journal/compression.js";

interface CompressionArguments {
  readonly dataRoot: string;
  readonly maxParts?: number;
}

function parseArguments(arguments_: readonly string[]): CompressionArguments {
  let dataRoot: string | undefined;
  let maxParts: number | undefined;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if (argument === "--data-root" && value !== undefined) {
      dataRoot = resolve(value);
      index += 1;
    } else if (argument === "--max-parts" && value !== undefined) {
      maxParts = Number(value);
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
  }

  if (dataRoot === undefined) {
    throw new Error(
      "Usage: node dist/collector/compress-entrypoint.js " +
        "--data-root <absolute-path> [--max-parts <count>]"
    );
  }
  return {
    dataRoot,
    ...(maxParts === undefined ? {} : { maxParts })
  };
}

const options = parseArguments(process.argv.slice(2));
const result = await compressClosedJournals({
  ...options,
  onProgress: (message) => console.error(message)
});
console.log(JSON.stringify(result));
