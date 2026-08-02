import { utcEpochMillisecondsSchema } from "../../collector/schema/primitives.js";

export function parseCoinbaseTimestamp(
  value: string,
  label = "Coinbase timestamp"
): number {
  const timestampMs = Date.parse(value);
  if (!Number.isFinite(timestampMs)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return utcEpochMillisecondsSchema.parse(timestampMs);
}

export function latestCoinbaseTimestamp(
  values: readonly string[],
  fallback: string
): number {
  if (values.length === 0) {
    return parseCoinbaseTimestamp(
      fallback,
      "Coinbase envelope timestamp"
    );
  }

  let latest = 0;
  for (const value of values) {
    latest = Math.max(
      latest,
      parseCoinbaseTimestamp(value, "Coinbase event timestamp")
    );
  }

  return latest;
}
