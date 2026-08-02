import { z } from "zod";

import { BINANCE_PUBLIC_PRODUCTS } from "./constants.js";

const safeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const rawDecimalSchema = z.string().min(1).max(256);
const productSchema = z.enum(BINANCE_PUBLIC_PRODUCTS);
const bookLevelSchema = z.tuple([rawDecimalSchema, rawDecimalSchema]);

export const binanceDepthUpdateSchema = z
  .object({
    e: z.literal("depthUpdate"),
    E: safeIntegerSchema,
    s: productSchema,
    U: safeIntegerSchema,
    u: safeIntegerSchema,
    b: z.array(bookLevelSchema).max(20_000),
    a: z.array(bookLevelSchema).max(20_000)
  })
  .refine((event) => event.U <= event.u, {
    message: "Binance depth first update ID exceeds final update ID"
  })
  .refine((event) => event.b.length + event.a.length > 0, {
    message: "Binance depth update contains no changes"
  });

export const binanceTradeSchema = z.object({
  e: z.literal("trade"),
  E: safeIntegerSchema,
  s: productSchema,
  t: safeIntegerSchema,
  p: rawDecimalSchema,
  q: rawDecimalSchema,
  T: safeIntegerSchema,
  m: z.boolean(),
  M: z.boolean()
});

const binanceUnknownEventSchema = z.object({
  e: z.string().min(1).max(128)
});

export const binanceCombinedStreamSchema = z.object({
  stream: z.string().min(1).max(256),
  data: z.unknown()
});

export const binanceDepthSnapshotSchema = z.object({
  lastUpdateId: safeIntegerSchema,
  bids: z.array(bookLevelSchema).min(1).max(5_000),
  asks: z.array(bookLevelSchema).min(1).max(5_000)
});

export const binanceSymbolFilterSchema = z.looseObject({
  filterType: z.string().min(1).max(128),
  minPrice: rawDecimalSchema.optional(),
  maxPrice: rawDecimalSchema.optional(),
  tickSize: rawDecimalSchema.optional(),
  minQty: rawDecimalSchema.optional(),
  maxQty: rawDecimalSchema.optional(),
  stepSize: rawDecimalSchema.optional(),
  minNotional: rawDecimalSchema.optional(),
  maxNotional: rawDecimalSchema.optional()
});

export const binanceSymbolInfoSchema = z.object({
  symbol: productSchema,
  status: z.string().min(1).max(64),
  baseAsset: z.string().min(1).max(32),
  quoteAsset: z.string().min(1).max(32),
  orderTypes: z.array(z.string().min(1).max(64)).max(100),
  isSpotTradingAllowed: z.boolean(),
  filters: z.array(binanceSymbolFilterSchema).max(100)
});

export const binanceExchangeInfoSchema = z.object({
  timezone: z.string().min(1).max(64),
  serverTime: safeIntegerSchema,
  symbols: z.array(binanceSymbolInfoSchema).min(1).max(100)
});

export type BinanceDepthUpdate = z.infer<
  typeof binanceDepthUpdateSchema
>;
export type BinanceTrade = z.infer<typeof binanceTradeSchema>;
export interface BinanceUnknownEvent {
  readonly e: string;
}
export interface BinanceCombinedStream {
  readonly stream: string;
  readonly data: BinanceDepthUpdate | BinanceTrade | BinanceUnknownEvent;
}
export type BinanceDepthSnapshot = z.infer<
  typeof binanceDepthSnapshotSchema
>;
export type BinanceSymbolFilter = z.infer<
  typeof binanceSymbolFilterSchema
>;
export type BinanceSymbolInfo = z.infer<
  typeof binanceSymbolInfoSchema
>;
export type BinanceExchangeInfo = z.infer<
  typeof binanceExchangeInfoSchema
>;

function parseJsonFrame(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid Binance JSON frame: ${reason}`);
  }
}

export function parseBinanceCombinedStream(
  input: string | unknown
): BinanceCombinedStream {
  const value = typeof input === "string" ? parseJsonFrame(input) : input;
  const wrapper = binanceCombinedStreamSchema.parse(value);
  const eventType = binanceUnknownEventSchema.parse(wrapper.data).e;
  switch (eventType) {
    case "depthUpdate":
      return {
        stream: wrapper.stream,
        data: binanceDepthUpdateSchema.parse(wrapper.data)
      };
    case "trade":
      return {
        stream: wrapper.stream,
        data: binanceTradeSchema.parse(wrapper.data)
      };
    default:
      return {
        stream: wrapper.stream,
        data: binanceUnknownEventSchema.parse(wrapper.data)
      };
  }
}
