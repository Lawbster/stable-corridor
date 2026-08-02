import { describe, expect, it } from "vitest";

import {
  BinanceBookIntegrityError,
  BinanceLevel2Book,
  compareBinancePositiveDecimals
} from "../../src/venues/binance/book.js";
import {
  binanceDepthSnapshot,
  binanceDepthUpdate
} from "../fixtures/binance.js";

describe("Binance level2 book", () => {
  it("normalizes, sorts, updates, and removes absolute levels", () => {
    const book = new BinanceLevel2Book(100);
    book.applySnapshot(binanceDepthSnapshot);
    expect(book.top(2)).toEqual({
      bids: [
        { price: "1.152", quantity: "31585.4" },
        { price: "1.1519", quantity: "20709.7" }
      ],
      asks: [
        { price: "1.1521", quantity: "8681.6" },
        { price: "1.1522", quantity: "5756.4" }
      ]
    });

    book.applyUpdate(binanceDepthUpdate.data);
    book.applyUpdate({
      ...binanceDepthUpdate.data,
      U: 190295612,
      u: 190295612,
      b: [["1.15200000", "0.00000000"]],
      a: [["1.15220000", "5700.00000000"]]
    });
    expect(book.top(2)).toEqual({
      bids: [
        { price: "1.1519", quantity: "20709.7" },
        { price: "1.1518", quantity: "35848.3" }
      ],
      asks: [
        { price: "1.1521", quantity: "8609.2" },
        { price: "1.1522", quantity: "5700" }
      ]
    });
  });

  it("applies updates transactionally and rejects crossed books", () => {
    const book = new BinanceLevel2Book(100);
    book.applySnapshot(binanceDepthSnapshot);
    expect(() =>
      book.applyUpdate({
        ...binanceDepthUpdate.data,
        b: [["1.15210000", "1.00000000"]],
        a: []
      })
    ).toThrowError(
      expect.objectContaining<Partial<BinanceBookIntegrityError>>({
        code: "crossed_book"
      })
    );
    expect(book.top(1).bids[0]).toEqual({
      price: "1.152",
      quantity: "31585.4"
    });
  });

  it("rejects duplicate snapshots, missing sides, and level overflow", () => {
    const duplicate = new BinanceLevel2Book(100);
    expect(() =>
      duplicate.applySnapshot({
        ...binanceDepthSnapshot,
        bids: [
          ["1.15200000", "1"],
          ["1.15200000", "2"]
        ]
      })
    ).toThrow(/Duplicate Binance snapshot level/u);

    const missing = new BinanceLevel2Book(100);
    expect(() =>
      missing.applySnapshot({
        ...binanceDepthSnapshot,
        asks: [["1.15210000", "0"]]
      })
    ).toThrow(/at least one bid and one ask/u);

    const bounded = new BinanceLevel2Book(1);
    expect(() => bounded.applySnapshot(binanceDepthSnapshot)).toThrow(
      /exceeded 1 levels/u
    );
  });

  it("requires a snapshot and compares decimals without floating point", () => {
    const book = new BinanceLevel2Book(10);
    expect(() => book.applyUpdate(binanceDepthUpdate.data)).toThrow(
      /before a snapshot/u
    );
    expect(compareBinancePositiveDecimals("1.10", "1.1")).toBe(0);
    expect(compareBinancePositiveDecimals("10", "9.999999999999")).toBe(1);
    expect(compareBinancePositiveDecimals("0.9999", "1")).toBe(-1);
  });
});
