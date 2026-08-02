import { z } from "zod";

import { BYBIT_PUBLIC_PRODUCTS } from "./constants.js";

const safeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const rawDecimalSchema = z.string().min(1).max(256);
const productSchema = z.enum(BYBIT_PUBLIC_PRODUCTS);
const bookLevelSchema = z.tuple([rawDecimalSchema, rawDecimalSchema]);

export const bybitOrderbookMessageSchema = z
  .object({
    topic: z.string().min(1).max(256),
    ts: safeIntegerSchema,
    type: z.enum(["snapshot", "delta"]),
    data: z.object({
      s: productSchema,
      b: z.array(bookLevelSchema).max(2_000),
      a: z.array(bookLevelSchema).max(2_000),
      u: safeIntegerSchema,
      seq: safeIntegerSchema
    }),
    cts: safeIntegerSchema
  })
  .refine(
    (message) =>
      message.type === "snapshot" ||
      message.data.b.length + message.data.a.length > 0,
    { message: "Bybit orderbook delta contains no changes" }
  );

export const bybitPublicTradeSchema = z.object({
  i: z.string().min(1).max(256),
  T: safeIntegerSchema,
  p: rawDecimalSchema,
  v: rawDecimalSchema,
  S: z.enum(["Buy", "Sell"]),
  seq: safeIntegerSchema,
  s: productSchema,
  BT: z.boolean().optional(),
  RPI: z.boolean().optional()
});

export const bybitPublicTradeMessageSchema = z.object({
  topic: z.string().min(1).max(256),
  ts: safeIntegerSchema,
  type: z.literal("snapshot"),
  data: z.array(bybitPublicTradeSchema).min(1).max(10_000)
});

export const bybitSubscriptionResponseSchema = z.object({
  success: z.boolean(),
  ret_msg: z.string().max(512),
  conn_id: z.string().min(1).max(256),
  req_id: z.string().max(256).optional(),
  op: z.literal("subscribe")
});

export const bybitPongResponseSchema = z.object({
  success: z.boolean(),
  ret_msg: z.literal("pong"),
  conn_id: z.string().min(1).max(256),
  req_id: z.string().max(256).optional(),
  op: z.enum(["ping", "pong"])
});

const bybitUnknownMessageSchema = z.looseObject({});

export const bybitSpotInstrumentSchema = z.object({
  symbol: productSchema,
  baseCoin: z.string().min(1).max(32),
  quoteCoin: z.string().min(1).max(32),
  status: z.string().min(1).max(64),
  lotSizeFilter: z.object({
    basePrecision: rawDecimalSchema,
    quotePrecision: rawDecimalSchema,
    minOrderQty: rawDecimalSchema.optional(),
    maxOrderQty: rawDecimalSchema.optional(),
    minOrderAmt: rawDecimalSchema,
    maxOrderAmt: rawDecimalSchema.optional(),
    maxLimitOrderQty: rawDecimalSchema,
    maxMarketOrderQty: rawDecimalSchema.optional(),
    postOnlyMaxLimitOrderSize: rawDecimalSchema.optional()
  }),
  priceFilter: z.object({
    tickSize: rawDecimalSchema
  })
});

export const bybitInstrumentResponseSchema = z.object({
  retCode: z.literal(0),
  retMsg: z.string().max(512),
  result: z.object({
    category: z.literal("spot"),
    list: z.array(bybitSpotInstrumentSchema).length(1)
  }),
  time: safeIntegerSchema
});

export const bybitResponseBaseSchema = z.object({
  retCode: z.number().int(),
  retMsg: z.string().max(512)
});

export type BybitOrderbookMessage = z.infer<
  typeof bybitOrderbookMessageSchema
>;
export type BybitPublicTrade = z.infer<typeof bybitPublicTradeSchema>;
export type BybitPublicTradeMessage = z.infer<
  typeof bybitPublicTradeMessageSchema
>;
export type BybitSubscriptionResponse = z.infer<
  typeof bybitSubscriptionResponseSchema
>;
export type BybitPongResponse = z.infer<typeof bybitPongResponseSchema>;
export type BybitSpotInstrument = z.infer<
  typeof bybitSpotInstrumentSchema
>;
export type BybitInstrumentResponse = z.infer<
  typeof bybitInstrumentResponseSchema
>;
export type BybitUnknownMessage = z.infer<
  typeof bybitUnknownMessageSchema
>;

export type BybitPublicMessage =
  | BybitOrderbookMessage
  | BybitPublicTradeMessage
  | BybitSubscriptionResponse
  | BybitPongResponse
  | BybitUnknownMessage;

function parseJsonFrame(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid Bybit JSON frame: ${reason}`);
  }
}

export function parseBybitPublicMessage(
  input: string | unknown
): BybitPublicMessage {
  const value = typeof input === "string" ? parseJsonFrame(input) : input;
  const shape = z
    .object({
      topic: z.string().optional(),
      op: z.string().optional(),
      ret_msg: z.string().optional()
    })
    .parse(value);

  if (shape.topic?.startsWith("orderbook.") === true) {
    return bybitOrderbookMessageSchema.parse(value);
  }
  if (shape.topic?.startsWith("publicTrade.") === true) {
    return bybitPublicTradeMessageSchema.parse(value);
  }
  if (shape.op === "subscribe") {
    return bybitSubscriptionResponseSchema.parse(value);
  }
  if (
    (shape.op === "ping" || shape.op === "pong") &&
    shape.ret_msg === "pong"
  ) {
    return bybitPongResponseSchema.parse(value);
  }
  return bybitUnknownMessageSchema.parse(value);
}
