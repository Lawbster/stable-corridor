import { describe, expect, it } from "vitest";

import {
  BybitBookIntegrityError,
  BybitLevel2Book,
  compareBybitPositiveDecimals
} from "../../src/venues/bybit/book.js";
import {
  bybitOrderbookDelta,
  bybitOrderbookSnapshot
} from "../fixtures/bybit.js";

describe("Bybit level-2 book", () => {
  it("sorts exact decimal prices and applies absolute updates", () => {
    expect(compareBybitPositiveDecimals("1.01", "1.001")).toBe(1);
    expect(compareBybitPositiveDecimals("1.000", "1")).toBe(0);

    const book = new BybitLevel2Book(100);
    book.applySnapshot(bybitOrderbookSnapshot);
    book.applyDelta(bybitOrderbookDelta);
    expect(book.top(2)).toEqual({
      bids: [
        { price: "1.0008", quantity: "4132998.99" },
        { price: "1.0007", quantity: "12561509.08" }
      ],
      asks: [
        { price: "1.0009", quantity: "7453629.2" },
        { price: "1.001", quantity: "49000.75" }
      ]
    });
  });

  it("removes zero quantities without mutating on invalid deltas", () => {
    const book = new BybitLevel2Book(100);
    book.applySnapshot(bybitOrderbookSnapshot);
    book.applyDelta({
      ...bybitOrderbookDelta,
      data: {
        ...bybitOrderbookDelta.data,
        b: [["1.0008", "0"]],
        a: []
      }
    });
    expect(book.top(1).bids[0]).toEqual({
      price: "1.0007",
      quantity: "12561509.08"
    });

    expect(() =>
      book.applyDelta({
        ...bybitOrderbookDelta,
        data: {
          ...bybitOrderbookDelta.data,
          b: [["1.001", "1"]],
          a: []
        }
      })
    ).toThrowError(BybitBookIntegrityError);
    expect(book.top(1)).toEqual({
      bids: [{ price: "1.0007", quantity: "12561509.08" }],
      asks: [{ price: "1.0009", quantity: "7453939.05" }]
    });
  });

  it("rejects updates before snapshots, duplicate levels, missing sides, and limits", () => {
    const uninitialized = new BybitLevel2Book(10);
    expect(() => uninitialized.applyDelta(bybitOrderbookDelta)).toThrow(
      /before a snapshot/u
    );

    const duplicate = new BybitLevel2Book(10);
    expect(() =>
      duplicate.applySnapshot({
        ...bybitOrderbookSnapshot,
        data: {
          ...bybitOrderbookSnapshot.data,
          b: [
            ["1.0008", "1"],
            ["1.00080", "2"]
          ]
        }
      })
    ).toThrow(/Duplicate Bybit snapshot level/u);

    const empty = new BybitLevel2Book(10);
    expect(() =>
      empty.applySnapshot({
        ...bybitOrderbookSnapshot,
        data: { ...bybitOrderbookSnapshot.data, a: [] }
      })
    ).toThrow(/at least one bid and one ask/u);

    const bounded = new BybitLevel2Book(1);
    expect(() =>
      bounded.applySnapshot(bybitOrderbookSnapshot)
    ).toThrow(/exceeded 1 levels/u);
  });
});
