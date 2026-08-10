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
import {
  JUPITER_APPROVED_INPUT_AMOUNTS,
  JUPITER_PUBLIC_PRODUCT
} from "../venues/jupiter/constants.js";

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
  .min(1)
  .max(COINBASE_PUBLIC_PRODUCTS.length)
  .refine(
    (products) => new Set(products).size === products.length,
    "Expected unique approved Coinbase products"
  );

const binanceProductsSchema = z
  .array(z.enum(BINANCE_PUBLIC_PRODUCTS))
  .min(1)
  .max(BINANCE_PUBLIC_PRODUCTS.length)
  .refine(
    (products) => new Set(products).size === products.length,
    "Expected unique approved Binance products"
  );

const bybitProductsSchema = z
  .array(z.enum(BYBIT_PUBLIC_PRODUCTS))
  .min(1)
  .max(BYBIT_PUBLIC_PRODUCTS.length)
  .refine(
    (products) => new Set(products).size === products.length,
    "Expected unique approved Bybit products"
  );

const krakenProductsSchema = z
  .array(z.enum(KRAKEN_PUBLIC_PRODUCTS))
  .min(1)
  .max(KRAKEN_PUBLIC_PRODUCTS.length)
  .refine(
    (products) => new Set(products).size === products.length,
    "Expected unique approved Kraken products"
  );

const jupiterInputAmountsSchema = z
  .array(z.enum(JUPITER_APPROVED_INPUT_AMOUNTS))
  .length(JUPITER_APPROVED_INPUT_AMOUNTS.length)
  .refine(
    (amounts) =>
      new Set(amounts).size === JUPITER_APPROVED_INPUT_AMOUNTS.length &&
      JUPITER_APPROVED_INPUT_AMOUNTS.every((amount) =>
        amounts.includes(amount)
      ),
    "Expected each approved Jupiter input amount exactly once"
  );

const anomalyProbeSchema = z.strictObject({
  coinbaseFeeBps: z.number().finite().nonnegative().max(100),
  modeledNetworkFeeUsdc: z.number().finite().nonnegative().max(10),
  executionBufferBps: z.number().finite().nonnegative().max(100),
  decisionThresholdBps: z.number().finite().positive().max(100),
  followUpCount: z.literal(3)
});

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
    reconnectDelayMs: positiveSafeIntegerSchema,
    restRequestTimeoutMs: positiveSafeIntegerSchema.max(60_000)
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
  }).optional(),
  binance: z.strictObject({
    products: binanceProductsSchema,
    staleAfterMs: positiveSafeIntegerSchema,
    maxTrackedLevelsPerSide: positiveSafeIntegerSchema.max(20_000),
    maxBufferedDepthEvents: positiveSafeIntegerSchema.max(100_000),
    maxFrameBytes: positiveSafeIntegerSchema
  }).optional(),
  bybit: z.strictObject({
    products: bybitProductsSchema,
    staleAfterMs: positiveSafeIntegerSchema,
    maxTrackedLevelsPerSide: positiveSafeIntegerSchema.max(20_000),
    maxRecentTradeIds: positiveSafeIntegerSchema.max(100_000),
    maxFrameBytes: positiveSafeIntegerSchema,
    pingIntervalMs: positiveSafeIntegerSchema
  }).optional(),
  kraken: z.strictObject({
    products: krakenProductsSchema,
    depth: z.literal(KRAKEN_BOOK_DEPTH),
    staleAfterMs: positiveSafeIntegerSchema,
    maxRecentTradeIds: positiveSafeIntegerSchema.max(100_000),
    maxFrameBytes: positiveSafeIntegerSchema
  }).optional(),
  jupiter: z
    .strictObject({
      product: z.literal(JUPITER_PUBLIC_PRODUCT),
      inputAmounts: jupiterInputAmountsSchema,
      minimumRequestIntervalMs:
        positiveSafeIntegerSchema.min(2_000),
      retryDelayMs: positiveSafeIntegerSchema,
      staleAfterMs: positiveSafeIntegerSchema,
      maxResponseBytes: positiveSafeIntegerSchema.max(1_048_576),
      anomalyProbe: anomalyProbeSchema.optional()
    })
    .optional()
})
  .refine(
    (config) =>
      config.coinbase !== undefined ||
      config.binance !== undefined ||
      config.bybit !== undefined ||
      config.kraken !== undefined ||
      config.jupiter !== undefined,
    "At least one public venue must be configured"
  )
  .superRefine((config, context) => {
    if (
      config.jupiter?.anomalyProbe !== undefined &&
      config.coinbase?.products.includes("EURC-USDC") !== true
    ) {
      context.addIssue({
        code: "custom",
        path: ["jupiter", "anomalyProbe"],
        message:
          "The Jupiter anomaly probe requires Coinbase EURC-USDC"
      });
    }
  });

export type CollectorConfig = z.infer<typeof collectorConfigSchema>;

export function parseCollectorConfig(input: unknown): CollectorConfig {
  return collectorConfigSchema.parse(input);
}
