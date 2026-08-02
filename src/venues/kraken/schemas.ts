import { z } from "zod";

import { KRAKEN_PUBLIC_PRODUCTS } from "./constants.js";

const safeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const uint32Schema = z.number().int().nonnegative().max(0xffffffff);
const rawDecimalSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^\d+(?:\.\d+)?$/u);
const timestampSchema = z.string().min(1).max(64);
const productSchema = z.enum(KRAKEN_PUBLIC_PRODUCTS);
const bookLevelSchema = z.strictObject({
  price: rawDecimalSchema,
  qty: rawDecimalSchema
});

export const krakenBookMessageSchema = z
  .strictObject({
    channel: z.literal("book"),
    type: z.enum(["snapshot", "update"]),
    data: z
      .array(
        z.strictObject({
          symbol: productSchema,
          bids: z.array(bookLevelSchema).max(2_000),
          asks: z.array(bookLevelSchema).max(2_000),
          checksum: uint32Schema,
          timestamp: timestampSchema
        })
      )
      .length(1)
  })
  .refine(
    (message) =>
      message.type === "snapshot" ||
      message.data[0]!.bids.length + message.data[0]!.asks.length > 0,
    { message: "Kraken book update contains no changes" }
  );

export const krakenTradeSchema = z.strictObject({
  symbol: productSchema,
  side: z.enum(["buy", "sell"]),
  price: rawDecimalSchema,
  qty: rawDecimalSchema,
  ord_type: z.enum(["limit", "market"]),
  trade_id: safeIntegerSchema,
  timestamp: timestampSchema
});

export const krakenTradeMessageSchema = z.strictObject({
  channel: z.literal("trade"),
  type: z.enum(["snapshot", "update"]),
  data: z.array(krakenTradeSchema).min(1).max(10_000)
});

export const krakenSubscriptionAckSchema = z.strictObject({
  method: z.literal("subscribe"),
  result: z.strictObject({
    channel: z.enum(["book", "trade"]),
    symbol: productSchema,
    snapshot: z.boolean(),
    depth: z
      .union([
        z.literal(10),
        z.literal(25),
        z.literal(100),
        z.literal(500),
        z.literal(1_000)
      ])
      .optional(),
    warnings: z.array(z.string().max(512)).max(32).optional()
  }),
  success: z.literal(true),
  time_in: timestampSchema,
  time_out: timestampSchema,
  req_id: safeIntegerSchema.optional()
});

export const krakenSubscriptionErrorSchema = z.object({
  method: z.literal("subscribe"),
  success: z.literal(false),
  error: z.string().min(1).max(512),
  req_id: safeIntegerSchema.optional()
});

export const krakenStatusMessageSchema = z.object({
  channel: z.literal("status"),
  type: z.enum(["snapshot", "update"]),
  data: z
    .array(
      z.object({
        system: z.string().min(1).max(64)
      })
    )
    .length(1)
});

export const krakenHeartbeatMessageSchema = z.strictObject({
  channel: z.literal("heartbeat")
});

const krakenPairSchema = z.object({
  altname: z.string().min(1).max(64),
  wsname: productSchema,
  base: z.string().min(1).max(32),
  quote: z.string().min(1).max(32),
  pair_decimals: safeIntegerSchema,
  lot_decimals: safeIntegerSchema,
  ordermin: rawDecimalSchema,
  costmin: rawDecimalSchema,
  tick_size: rawDecimalSchema,
  status: z.string().min(1).max(64),
  execution_venue: z.string().min(1).max(64).optional()
});

export const krakenAssetPairsResponseSchema = z.object({
  error: z.array(z.string().max(512)).max(128),
  result: z.record(z.string().min(1).max(64), krakenPairSchema)
});

const krakenUnknownMessageSchema = z.looseObject({});

export type KrakenBookMessage = z.infer<typeof krakenBookMessageSchema>;
export type KrakenTrade = z.infer<typeof krakenTradeSchema>;
export type KrakenTradeMessage = z.infer<typeof krakenTradeMessageSchema>;
export type KrakenSubscriptionAck = z.infer<
  typeof krakenSubscriptionAckSchema
>;
export type KrakenSubscriptionError = z.infer<
  typeof krakenSubscriptionErrorSchema
>;
export type KrakenStatusMessage = z.infer<
  typeof krakenStatusMessageSchema
>;
export type KrakenHeartbeatMessage = z.infer<
  typeof krakenHeartbeatMessageSchema
>;
export type KrakenAssetPair = z.infer<typeof krakenPairSchema>;
export type KrakenAssetPairsResponse = z.infer<
  typeof krakenAssetPairsResponseSchema
>;
export type KrakenUnknownMessage = z.infer<
  typeof krakenUnknownMessageSchema
>;

export type KrakenPublicMessage =
  | KrakenBookMessage
  | KrakenTradeMessage
  | KrakenSubscriptionAck
  | KrakenSubscriptionError
  | KrakenStatusMessage
  | KrakenHeartbeatMessage
  | KrakenUnknownMessage;

function closingQuoteIndex(input: string, start: number): number {
  let escaped = false;
  for (let index = start + 1; index < input.length; index += 1) {
    const character = input[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') {
      return index;
    }
  }
  throw new Error("Unterminated JSON string");
}

function quoteDecimalFields(input: string): string {
  let output = "";
  let index = 0;
  while (index < input.length) {
    if (input[index] !== '"') {
      output += input[index]!;
      index += 1;
      continue;
    }

    const end = closingQuoteIndex(input, index);
    const token = input.slice(index, end + 1);
    output += token;
    let cursor = end + 1;
    while (/\s/u.test(input[cursor] ?? "")) {
      output += input[cursor]!;
      cursor += 1;
    }
    if (input[cursor] !== ":") {
      index = cursor;
      continue;
    }

    output += ":";
    cursor += 1;
    while (/\s/u.test(input[cursor] ?? "")) {
      output += input[cursor]!;
      cursor += 1;
    }

    let key: unknown;
    try {
      key = JSON.parse(token);
    } catch {
      throw new Error("Invalid JSON object key");
    }
    if (
      (key !== "price" && key !== "qty") ||
      input[cursor] === '"'
    ) {
      index = cursor;
      continue;
    }

    const match = /^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(
      input.slice(cursor)
    );
    if (match === null) {
      index = cursor;
      continue;
    }
    output += JSON.stringify(match[0]);
    index = cursor + match[0].length;
  }
  return output;
}

function parseJsonFrame(input: string): unknown {
  try {
    return JSON.parse(quoteDecimalFields(input));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid Kraken JSON frame: ${reason}`);
  }
}

export function parseKrakenPublicMessage(
  input: string | unknown
): KrakenPublicMessage {
  const value = typeof input === "string" ? parseJsonFrame(input) : input;
  const shape = z
    .object({
      channel: z.string().optional(),
      method: z.string().optional(),
      success: z.boolean().optional()
    })
    .parse(value);

  if (shape.channel === "book") {
    return krakenBookMessageSchema.parse(value);
  }
  if (shape.channel === "trade") {
    return krakenTradeMessageSchema.parse(value);
  }
  if (shape.channel === "status") {
    return krakenStatusMessageSchema.parse(value);
  }
  if (shape.channel === "heartbeat") {
    return krakenHeartbeatMessageSchema.parse(value);
  }
  if (shape.method === "subscribe" && shape.success === true) {
    return krakenSubscriptionAckSchema.parse(value);
  }
  if (shape.method === "subscribe" && shape.success === false) {
    return krakenSubscriptionErrorSchema.parse(value);
  }
  return krakenUnknownMessageSchema.parse(value);
}
