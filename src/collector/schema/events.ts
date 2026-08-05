import { z } from "zod";

import {
  assetSchema,
  canonicalDecimalStringSchema,
  canonicalProductSchema,
  checksumSchema,
  collectorRunIdSchema,
  connectionIdSchema,
  nativeProductSchema,
  nonNegativeDecimalStringSchema,
  nonNegativeSafeIntegerSchema,
  positiveDecimalStringSchema,
  positiveSafeIntegerSchema,
  schemaVersionSchema,
  utcEpochMillisecondsSchema,
  venueSchema,
  venueSequenceSchema
} from "./primitives.js";

const sourceSchema = z.enum(["websocket", "rest", "external"]);
const bookSideSchema = z.enum(["bid", "ask"]);
const tradeSideSchema = z.enum(["buy", "sell", "unknown"]);
const marketStatusSchema = z.enum([
  "online",
  "limit_only",
  "post_only",
  "cancel_only",
  "view_only",
  "offline",
  "unknown"
]);
const railStatusSchema = z.enum([
  "enabled",
  "disabled",
  "maintenance",
  "unknown"
]);

export const normalizedEventTypeSchema = z.enum([
  "instrument",
  "book_checkpoint",
  "book_delta",
  "trade",
  "trade_continuity",
  "market_status",
  "feed_status",
  "public_rail_status"
]);

const commonEnvelopeShape = {
  schemaVersion: schemaVersionSchema,
  venue: venueSchema,
  product: canonicalProductSchema,
  nativeProduct: nativeProductSchema,
  sourceTimestampMs: utcEpochMillisecondsSchema.nullable(),
  receivedTimestampMs: utcEpochMillisecondsSchema,
  ingestSequence: nonNegativeSafeIntegerSchema,
  collectorRunId: collectorRunIdSchema,
  connectionId: connectionIdSchema,
  venueSequence: venueSequenceSchema,
  source: sourceSchema
};

const bookLevelSchema = z.strictObject({
  price: positiveDecimalStringSchema,
  quantity: nonNegativeDecimalStringSchema
});

const absoluteBookChangeSchema = z.strictObject({
  side: bookSideSchema,
  price: positiveDecimalStringSchema,
  quantity: nonNegativeDecimalStringSchema
});

const relativeBookChangeSchema = z.strictObject({
  side: bookSideSchema,
  price: positiveDecimalStringSchema,
  quantityDelta: canonicalDecimalStringSchema
});

export const instrumentEventSchema = z.strictObject({
  ...commonEnvelopeShape,
  eventType: z.literal("instrument"),
  payload: z.strictObject({
    baseAsset: assetSchema,
    quoteAsset: assetSchema,
    status: marketStatusSchema,
    tickSize: positiveDecimalStringSchema,
    quantityStep: positiveDecimalStringSchema,
    minimumQuantity: positiveDecimalStringSchema.nullable(),
    maximumQuantity: positiveDecimalStringSchema.nullable(),
    minimumNotional: positiveDecimalStringSchema.nullable(),
    maximumNotional: positiveDecimalStringSchema.nullable(),
    observedAtMs: utcEpochMillisecondsSchema
  })
});

export const bookCheckpointEventSchema = z.strictObject({
  ...commonEnvelopeShape,
  eventType: z.literal("book_checkpoint"),
  payload: z.strictObject({
    bids: z.array(bookLevelSchema).max(1_000),
    asks: z.array(bookLevelSchema).max(1_000),
    depth: positiveSafeIntegerSchema.max(1_000),
    checksum: checksumSchema,
    isRecovery: z.boolean()
  })
});

const absoluteBookDeltaPayloadSchema = z.strictObject({
  updateSemantics: z.literal("absolute"),
  firstVenueSequence: venueSequenceSchema,
  lastVenueSequence: venueSequenceSchema,
  changes: z.array(absoluteBookChangeSchema).min(1).max(10_000)
});

const relativeBookDeltaPayloadSchema = z.strictObject({
  updateSemantics: z.literal("relative"),
  firstVenueSequence: venueSequenceSchema,
  lastVenueSequence: venueSequenceSchema,
  changes: z.array(relativeBookChangeSchema).min(1).max(10_000)
});

export const bookDeltaEventSchema = z.strictObject({
  ...commonEnvelopeShape,
  eventType: z.literal("book_delta"),
  payload: z.discriminatedUnion("updateSemantics", [
    absoluteBookDeltaPayloadSchema,
    relativeBookDeltaPayloadSchema
  ])
});

export const tradeEventSchema = z.strictObject({
  ...commonEnvelopeShape,
  eventType: z.literal("trade"),
  payload: z.strictObject({
    tradeId: z.string().min(1).max(256).nullable(),
    price: positiveDecimalStringSchema,
    quantity: positiveDecimalStringSchema,
    aggressorSide: tradeSideSchema
  })
});

export const tradeContinuityEventSchema = z.strictObject({
  ...commonEnvelopeShape,
  eventType: z.literal("trade_continuity"),
  payload: z.strictObject({
    messageType: z.enum(["snapshot", "update"]),
    previousTradeId: z.string().min(1).max(256).nullable(),
    firstObservedTradeId: z.string().min(1).max(256),
    lastObservedTradeId: z.string().min(1).max(256),
    firstAcceptedTradeId: z.string().min(1).max(256).nullable(),
    lastAcceptedTradeId: z.string().min(1).max(256).nullable(),
    acceptedTradeCount: nonNegativeSafeIntegerSchema,
    overlapTradeCount: nonNegativeSafeIntegerSchema,
    duplicateTradeCount: nonNegativeSafeIntegerSchema,
    nonAdjacentIdObserved: z.boolean(),
    observedAtMs: utcEpochMillisecondsSchema
  })
});

export const marketStatusEventSchema = z.strictObject({
  ...commonEnvelopeShape,
  eventType: z.literal("market_status"),
  payload: z.strictObject({
    status: marketStatusSchema,
    reason: z.string().min(1).max(512).nullable(),
    observedAtMs: utcEpochMillisecondsSchema
  })
});

export const feedStatusEventSchema = z.strictObject({
  ...commonEnvelopeShape,
  eventType: z.literal("feed_status"),
  payload: z.strictObject({
    state: z.enum([
      "connecting",
      "healthy",
      "stale",
      "gapped",
      "recovering",
      "stopped"
    ]),
    eligibleForResearch: z.boolean(),
    reason: z.string().min(1).max(512).nullable(),
    lastGoodVenueSequence: venueSequenceSchema,
    observedAtMs: utcEpochMillisecondsSchema
  })
});

export const publicRailStatusEventSchema = z.strictObject({
  ...commonEnvelopeShape,
  eventType: z.literal("public_rail_status"),
  payload: z.strictObject({
    asset: assetSchema,
    network: z.string().min(1).max(128),
    depositStatus: railStatusSchema,
    withdrawalStatus: railStatusSchema,
    accountSpecific: z.literal(false),
    reason: z.string().min(1).max(512).nullable(),
    observedAtMs: utcEpochMillisecondsSchema
  })
});

export const normalizedEventSchema = z.discriminatedUnion("eventType", [
  instrumentEventSchema,
  bookCheckpointEventSchema,
  bookDeltaEventSchema,
  tradeEventSchema,
  tradeContinuityEventSchema,
  marketStatusEventSchema,
  feedStatusEventSchema,
  publicRailStatusEventSchema
]);

export type NormalizedEvent = z.infer<typeof normalizedEventSchema>;
export type NormalizedEventType = NormalizedEvent["eventType"];

export function parseNormalizedEvent(input: unknown): NormalizedEvent {
  return normalizedEventSchema.parse(input);
}
