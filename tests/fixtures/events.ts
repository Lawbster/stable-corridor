import {
  tradeEventSchema,
  type NormalizedEvent
} from "../../src/collector/schema/events.js";

const collectorRunId = "11111111-1111-4111-8111-111111111111";
const connectionId = "22222222-2222-4222-8222-222222222222";

export type TradeEvent = Extract<
  NormalizedEvent,
  { readonly eventType: "trade" }
>;

export interface TradeEventOverrides {
  readonly venue?: string;
  readonly product?: string;
  readonly sourceTimestampMs?: number | null;
  readonly receivedTimestampMs?: number;
  readonly ingestSequence?: number;
  readonly collectorRunId?: string;
  readonly connectionId?: string;
  readonly venueSequence?: string | null;
  readonly price?: string;
  readonly quantity?: string;
}

export function makeTradeEvent(
  overrides: TradeEventOverrides = {}
): TradeEvent {
  return tradeEventSchema.parse({
    schemaVersion: 1,
    eventType: "trade",
    venue: overrides.venue ?? "coinbase",
    product: overrides.product ?? "EURC-USDC",
    nativeProduct: overrides.product ?? "EURC-USDC",
    sourceTimestampMs: overrides.sourceTimestampMs ?? 1_700_000_000_000,
    receivedTimestampMs:
      overrides.receivedTimestampMs ?? 1_700_000_000_010,
    ingestSequence: overrides.ingestSequence ?? 1,
    collectorRunId: overrides.collectorRunId ?? collectorRunId,
    connectionId: overrides.connectionId ?? connectionId,
    venueSequence: overrides.venueSequence ?? "100",
    source: "websocket",
    payload: {
      tradeId: "trade-1",
      price: overrides.price ?? "1.1521",
      quantity: overrides.quantity ?? "10",
      aggressorSide: "buy"
    }
  });
}
