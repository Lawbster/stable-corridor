import { posix, win32 } from "node:path";

import { z } from "zod";

import {
  positiveSafeIntegerSchema,
  schemaVersionSchema
} from "./schema/primitives.js";
import { COINBASE_PUBLIC_PRODUCTS } from "../venues/coinbase/constants.js";
import { BINANCE_PUBLIC_PRODUCTS } from "../venues/binance/constants.js";
import { BYBIT_PUBLIC_PRODUCTS } from "../venues/bybit/constants.js";
import {
  KRAKEN_BOOK_DEPTH,
  KRAKEN_PUBLIC_PRODUCTS
} from "../venues/kraken/constants.js";

const absolutePathSchema = z
  .string()
  .min(1)
  .refine(
    (value) => posix.isAbsolute(value) || win32.isAbsolute(value),
    "Expected an absolute filesystem path"
  )
  .refine(
    (value) => {
      const normalized = value.replaceAll("\\", "/").toLowerCase();
      const sharedServicePath = ["", "opt", "bybit-rev"].join("/");
      const evidenceProjectPath = `/${"reverse"}-${"copy"}/`;
      return (
        !normalized.includes(sharedServicePath) &&
        !normalized.includes(evidenceProjectPath)
      );
    },
    "Runtime paths must remain isolated from the HYPE project"
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

const binanceProductsSchema = z
  .array(z.enum(BINANCE_PUBLIC_PRODUCTS))
  .length(BINANCE_PUBLIC_PRODUCTS.length)
  .refine(
    (products) =>
      new Set(products).size === BINANCE_PUBLIC_PRODUCTS.length &&
      BINANCE_PUBLIC_PRODUCTS.every((product) =>
        products.includes(product)
      ),
    "Expected each approved Binance product exactly once"
  );

const bybitProductsSchema = z
  .array(z.enum(BYBIT_PUBLIC_PRODUCTS))
  .length(BYBIT_PUBLIC_PRODUCTS.length)
  .refine(
    (products) =>
      new Set(products).size === BYBIT_PUBLIC_PRODUCTS.length &&
      BYBIT_PUBLIC_PRODUCTS.every((product) =>
        products.includes(product)
      ),
    "Expected each approved Bybit product exactly once"
  );

const krakenProductsSchema = z
  .array(z.enum(KRAKEN_PUBLIC_PRODUCTS))
  .length(KRAKEN_PUBLIC_PRODUCTS.length)
  .refine(
    (products) =>
      new Set(products).size === KRAKEN_PUBLIC_PRODUCTS.length &&
      KRAKEN_PUBLIC_PRODUCTS.every((product) =>
        products.includes(product)
      ),
    "Expected each approved Kraken product exactly once"
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
  runtime: z.strictObject({
    healthIntervalMs: positiveSafeIntegerSchema,
    staleCheckIntervalMs: positiveSafeIntegerSchema,
    reconnectDelayMs: positiveSafeIntegerSchema
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
  }),
  binance: z.strictObject({
    products: binanceProductsSchema,
    staleAfterMs: positiveSafeIntegerSchema,
    maxTrackedLevelsPerSide: positiveSafeIntegerSchema.max(20_000),
    maxBufferedDepthEvents: positiveSafeIntegerSchema.max(100_000),
    maxFrameBytes: positiveSafeIntegerSchema
  }),
  bybit: z.strictObject({
    products: bybitProductsSchema,
    staleAfterMs: positiveSafeIntegerSchema,
    maxTrackedLevelsPerSide: positiveSafeIntegerSchema.max(20_000),
    maxRecentTradeIds: positiveSafeIntegerSchema.max(100_000),
    maxFrameBytes: positiveSafeIntegerSchema,
    pingIntervalMs: positiveSafeIntegerSchema
  }),
  kraken: z.strictObject({
    products: krakenProductsSchema,
    depth: z.literal(KRAKEN_BOOK_DEPTH),
    staleAfterMs: positiveSafeIntegerSchema,
    maxRecentTradeIds: positiveSafeIntegerSchema.max(100_000),
    maxFrameBytes: positiveSafeIntegerSchema
  })
});

export type CollectorConfig = z.infer<typeof collectorConfigSchema>;

export function parseCollectorConfig(input: unknown): CollectorConfig {
  return collectorConfigSchema.parse(input);
}
