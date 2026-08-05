import { describe, expect, it } from "vitest";

import {
  bookDeltaEventSchema,
  normalizedEventSchema,
  publicRailStatusEventSchema,
  tradeContinuityEventSchema
} from "../../src/collector/schema/events.js";
import { makeTradeEvent } from "../fixtures/events.js";

describe("normalized event schemas", () => {
  it("accepts a strict normalized trade event", () => {
    const event = makeTradeEvent();
    expect(normalizedEventSchema.parse(event)).toEqual(event);
  });

  it("rejects unknown envelope fields", () => {
    const event = {
      ...makeTradeEvent(),
      accountId: "must-not-enter-public-data"
    };
    expect(normalizedEventSchema.safeParse(event).success).toBe(false);
  });

  it("requires a local receive timestamp independently of source time", () => {
    const event = makeTradeEvent({
      sourceTimestampMs: 1_700_000_100_000,
      receivedTimestampMs: 1_700_000_000_000
    });
    expect(event.sourceTimestampMs).toBeGreaterThan(
      event.receivedTimestampMs
    );
  });

  it("records structured trade-continuity evidence", () => {
    const trade = makeTradeEvent();
    const continuity = {
      ...trade,
      eventType: "trade_continuity",
      payload: {
        messageType: "update",
        previousTradeId: "100",
        firstObservedTradeId: "102",
        lastObservedTradeId: "103",
        firstAcceptedTradeId: "102",
        lastAcceptedTradeId: "103",
        acceptedTradeCount: 2,
        overlapTradeCount: 0,
        duplicateTradeCount: 0,
        nonAdjacentIdObserved: true,
        observedAtMs: trade.receivedTimestampMs
      }
    };

    expect(tradeContinuityEventSchema.parse(continuity)).toEqual(
      continuity
    );
  });

  it("rejects negative quantities for absolute book updates", () => {
    const trade = makeTradeEvent();
    const result = bookDeltaEventSchema.safeParse({
      ...trade,
      eventType: "book_delta",
      payload: {
        updateSemantics: "absolute",
        firstVenueSequence: "100",
        lastVenueSequence: "101",
        changes: [
          {
            side: "bid",
            price: "1.1521",
            quantity: "-1"
          }
        ]
      }
    });
    expect(result.success).toBe(false);
  });

  it("marks rail status as explicitly non-account-specific", () => {
    const trade = makeTradeEvent();
    const publicRail = {
      ...trade,
      eventType: "public_rail_status",
      payload: {
        asset: "USDC",
        network: "solana",
        depositStatus: "enabled",
        withdrawalStatus: "enabled",
        accountSpecific: false,
        reason: null,
        observedAtMs: trade.receivedTimestampMs
      }
    };

    expect(publicRailStatusEventSchema.parse(publicRail)).toEqual(publicRail);
    expect(
      publicRailStatusEventSchema.safeParse({
        ...publicRail,
        payload: {
          ...publicRail.payload,
          accountSpecific: true
        }
      }).success
    ).toBe(false);
  });
});
