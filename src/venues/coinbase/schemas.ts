import { z } from "zod";

import { COINBASE_PUBLIC_PRODUCTS } from "./constants.js";

const timestampSchema = z.string().min(1).max(128);
const sequenceNumberSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const productIdSchema = z.enum(COINBASE_PUBLIC_PRODUCTS);
const rawDecimalSchema = z.string().min(1).max(256);

export const coinbaseAdvancedProductSchema = z.object({
  product_id: productIdSchema,
  base_increment: rawDecimalSchema,
  quote_increment: rawDecimalSchema,
  quote_min_size: rawDecimalSchema,
  quote_max_size: rawDecimalSchema,
  base_min_size: rawDecimalSchema,
  base_max_size: rawDecimalSchema,
  status: z.string().min(1).max(64),
  cancel_only: z.boolean(),
  limit_only: z.boolean(),
  post_only: z.boolean(),
  trading_disabled: z.boolean(),
  view_only: z.boolean(),
  product_type: z.string().min(1).max(64),
  quote_currency_id: z.string().min(1).max(32),
  base_currency_id: z.string().min(1).max(32)
});

export const coinbaseLevel2UpdateSchema = z.object({
  side: z.enum(["bid", "offer"]),
  event_time: timestampSchema,
  price_level: rawDecimalSchema,
  new_quantity: rawDecimalSchema
});

const coinbaseLevel2EventSchema = z.object({
  type: z.enum(["snapshot", "update"]),
  product_id: productIdSchema,
  updates: z.array(coinbaseLevel2UpdateSchema).min(1).max(20_000)
});

export const coinbaseLevel2EnvelopeSchema = z.object({
  channel: z.literal("l2_data"),
  timestamp: timestampSchema,
  sequence_num: sequenceNumberSchema,
  events: z.array(coinbaseLevel2EventSchema).min(1).max(100)
});

export const coinbaseMarketTradeSchema = z.object({
  product_id: productIdSchema,
  trade_id: z.string().regex(/^\d+$/u),
  price: rawDecimalSchema,
  size: rawDecimalSchema,
  time: timestampSchema,
  side: z.enum(["BUY", "SELL"])
});

const coinbaseMarketTradesEventSchema = z.object({
  type: z.enum(["snapshot", "update"]),
  trades: z.array(coinbaseMarketTradeSchema).min(1).max(10_000)
});

export const coinbaseMarketTradesEnvelopeSchema = z.object({
  channel: z.literal("market_trades"),
  timestamp: timestampSchema,
  sequence_num: sequenceNumberSchema,
  events: z.array(coinbaseMarketTradesEventSchema).min(1).max(100)
});

const heartbeatCounterSchema = z.union([
  z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  z.string().regex(/^\d+$/u)
]);

export const coinbaseHeartbeatsEnvelopeSchema = z.object({
  channel: z.literal("heartbeats"),
  timestamp: timestampSchema,
  sequence_num: sequenceNumberSchema,
  events: z
    .array(
      z.object({
        current_time: z.string().min(1).max(256),
        heartbeat_counter: heartbeatCounterSchema
      })
    )
    .min(1)
    .max(10)
});

export const coinbaseStatusProductSchema = z.object({
  id: productIdSchema,
  status: z.string().min(1).max(64),
  status_message: z.string().max(512)
});

const coinbaseStatusEventSchema = z.object({
  type: z.enum(["snapshot", "update"]),
  products: z.array(coinbaseStatusProductSchema).max(10_000)
});

export const coinbaseStatusEnvelopeSchema = z.object({
  channel: z.literal("status"),
  timestamp: timestampSchema,
  sequence_num: sequenceNumberSchema,
  events: z.array(coinbaseStatusEventSchema).min(1).max(100)
});

const coinbaseBaseEnvelopeSchema = z.object({
  channel: z.string().min(1).max(128),
  timestamp: timestampSchema,
  sequence_num: sequenceNumberSchema,
  events: z.array(z.unknown()).max(10_000)
});

export type CoinbaseAdvancedProduct = z.infer<
  typeof coinbaseAdvancedProductSchema
>;
export type CoinbaseLevel2Update = z.infer<
  typeof coinbaseLevel2UpdateSchema
>;
export type CoinbaseLevel2Envelope = z.infer<
  typeof coinbaseLevel2EnvelopeSchema
>;
export type CoinbaseMarketTrade = z.infer<
  typeof coinbaseMarketTradeSchema
>;
export type CoinbaseMarketTradesEnvelope = z.infer<
  typeof coinbaseMarketTradesEnvelopeSchema
>;
export type CoinbaseHeartbeatsEnvelope = z.infer<
  typeof coinbaseHeartbeatsEnvelopeSchema
>;
export type CoinbaseStatusProduct = z.infer<
  typeof coinbaseStatusProductSchema
>;
export type CoinbaseStatusEnvelope = z.infer<
  typeof coinbaseStatusEnvelopeSchema
>;
export type CoinbaseUnknownEnvelope = z.infer<
  typeof coinbaseBaseEnvelopeSchema
>;

export type CoinbaseAdvancedEnvelope =
  | CoinbaseLevel2Envelope
  | CoinbaseMarketTradesEnvelope
  | CoinbaseHeartbeatsEnvelope
  | CoinbaseStatusEnvelope
  | CoinbaseUnknownEnvelope;

function parseJsonFrame(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid Coinbase JSON frame: ${reason}`);
  }
}

export function parseCoinbaseAdvancedEnvelope(
  input: string | unknown
): CoinbaseAdvancedEnvelope {
  const value = typeof input === "string" ? parseJsonFrame(input) : input;
  const base = coinbaseBaseEnvelopeSchema.parse(value);

  switch (base.channel) {
    case "l2_data":
      return coinbaseLevel2EnvelopeSchema.parse(value);
    case "market_trades":
      return coinbaseMarketTradesEnvelopeSchema.parse(value);
    case "heartbeats":
      return coinbaseHeartbeatsEnvelopeSchema.parse(value);
    case "status":
      return coinbaseStatusEnvelopeSchema.parse(value);
    default:
      return base;
  }
}
