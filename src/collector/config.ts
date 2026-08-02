import { posix, win32 } from "node:path";

import { z } from "zod";

import {
  positiveSafeIntegerSchema,
  schemaVersionSchema
} from "./schema/primitives.js";
import { COINBASE_PUBLIC_PRODUCTS } from "../venues/coinbase/constants.js";

const absolutePathSchema = z
  .string()
  .min(1)
  .refine(
    (value) => posix.isAbsolute(value) || win32.isAbsolute(value),
    "Expected an absolute filesystem path"
  );

const coinbaseProductsSchema = z
  .array(z.enum(COINBASE_PUBLIC_PRODUCTS))
  .length(COINBASE_PUBLIC_PRODUCTS.length)
  .refine(
    (products) =>
      new Set(products).size === COINBASE_PUBLIC_PRODUCTS.length &&
      COINBASE_PUBLIC_PRODUCTS.every((product) =>
        products.includes(product)
      ),
    "Expected each approved Coinbase product exactly once"
  );

export const collectorConfigSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  processName: z.literal("stable-corridor-collector"),
  dataRoot: absolutePathSchema,
  healthFile: absolutePathSchema,
  journal: z.strictObject({
    maxPartBytes: positiveSafeIntegerSchema,
    syncEveryAppend: z.boolean()
  }),
  storage: z.strictObject({
    maxDataBytes: positiveSafeIntegerSchema,
    minFreeBytes: positiveSafeIntegerSchema
  }),
  book: z.strictObject({
    depth: positiveSafeIntegerSchema.max(1_000),
    checkpointIntervalMs: positiveSafeIntegerSchema
  }),
  coinbase: z.strictObject({
    products: coinbaseProductsSchema,
    staleAfterMs: positiveSafeIntegerSchema,
    maxTrackedLevelsPerSide: positiveSafeIntegerSchema.max(20_000),
    maxFrameBytes: positiveSafeIntegerSchema
  })
});

export type CollectorConfig = z.infer<typeof collectorConfigSchema>;

export function parseCollectorConfig(input: unknown): CollectorConfig {
  return collectorConfigSchema.parse(input);
}
