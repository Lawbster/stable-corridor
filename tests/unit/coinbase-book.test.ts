import { describe, expect, it } from "vitest";

import {
  CoinbaseBookIntegrityError,
  CoinbaseLevel2Book,
  compareCanonicalPositiveDecimals
} from "../../src/venues/coinbase/book.js";
import type { CoinbaseLevel2Update } from "../../src/venues/coinbase/schemas.js";
import { coinbaseLevel2Snapshot } from "../fixtures/coinbase.js";

const snapshotUpdates =
  coinbaseLevel2Snapshot.events[0].updates as readonly CoinbaseLevel2Update[];

describe("Coinbase level2 book", () => {
  it("compares decimal prices without floating point", () => {
    expect(compareCanonicalPositiveDecimals("10", "9.999999999999")).toBe(1);
    expect(compareCanonicalPositiveDecimals("1.10", "1.1")).toBe(0);
    expect(compareCanonicalPositiveDecimals("0.999", "1")).toBe(-1);
  });

  it("sorts a snapshot and normalizes persisted decimals", () => {
    const book = new CoinbaseLevel2Book(100);

    book.applySnapshot(snapshotUpdates);

    expect(book.top(2)).toEqual({
      bids: [
        { price: "1.1519", quantity: "8200" },
        { price: "1.1518", quantity: "8683" }
      ],
      asks: [
        { price: "1.1521", quantity: "4172" },
        { price: "1.1522", quantity: "52" }
      ]
    });
  });

  it("applies absolute quantities and removes zero levels", () => {
    const book = new CoinbaseLevel2Book(100);
    book.applySnapshot(snapshotUpdates);

    book.applyUpdate([
      {
        side: "bid",
        event_time: "2026-08-02T00:53:12Z",
        price_level: "1.1519",
        new_quantity: "8100.00"
      },
      {
        side: "offer",
        event_time: "2026-08-02T00:53:12Z",
        price_level: "1.1521",
        new_quantity: "0.000"
      }
    ]);

    expect(book.top(1)).toEqual({
      bids: [{ price: "1.1519", quantity: "8100" }],
      asks: [{ price: "1.1522", quantity: "52" }]
    });
  });

  it("requires a snapshot before updates", () => {
    const book = new CoinbaseLevel2Book(100);

    expect(() => book.applyUpdate(snapshotUpdates)).toThrow(
      CoinbaseBookIntegrityError
    );
  });

  it("rejects duplicate snapshot levels", () => {
    const book = new CoinbaseLevel2Book(100);

    expect(() =>
      book.applySnapshot([...snapshotUpdates, snapshotUpdates[0]!])
    ).toThrow(/Duplicate Coinbase snapshot level/u);
  });

  it("rejects missing or oversized sides", () => {
    const missingSide = new CoinbaseLevel2Book(100);
    expect(() =>
      missingSide.applySnapshot(
        snapshotUpdates.filter((update) => update.side === "bid")
      )
    ).toThrow(/at least one bid and one ask/u);

    const limited = new CoinbaseLevel2Book(1);
    expect(() => limited.applySnapshot(snapshotUpdates)).toThrow(
      /exceeded 1 levels/u
    );
  });

  it("rejects a crossed update transactionally", () => {
    const book = new CoinbaseLevel2Book(100);
    book.applySnapshot(snapshotUpdates);
    const before = book.top(2);

    expect(() =>
      book.applyUpdate([
        {
          side: "bid",
          event_time: "2026-08-02T00:53:12Z",
          price_level: "1.1521",
          new_quantity: "1"
        }
      ])
    ).toThrow(/book is crossed/u);
    expect(book.top(2)).toEqual(before);
  });
});
