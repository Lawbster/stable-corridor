import { utcEpochMillisecondsSchema } from "../../collector/schema/primitives.js";

export function parseKrakenTimestamp(
  value: string,
  label = "Kraken timestamp"
): number {
  const timestampMs = Date.parse(value);
  if (!Number.isFinite(timestampMs)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return utcEpochMillisecondsSchema.parse(timestampMs);
}
