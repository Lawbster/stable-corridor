import { describe, expect, it } from "vitest";

import {
  KrakenBookIntegrityError,
  KrakenLevel2Book,
  compareKrakenPositiveDecimals
} from "../../src/venues/kraken/book.js";
import {
  krakenBookMessageSchema,
  parseKrakenPublicMessage
} from "../../src/venues/kraken/schemas.js";
import {
  krakenBookSnapshotRaw,
  krakenBookUpdateRaw
} from "../fixtures/kraken.js";

function bookMessage(raw: string) {
  return krakenBookMessageSchema.parse(parseKrakenPublicMessage(raw));
}

describe("Kraken checksum-validated level-2 book", () => {
  it("applies the recorded snapshot and absolute update", () => {
    expect(compareKrakenPositiveDecimals("1.01", "1.001")).toBe(1);
    const book = new KrakenLevel2Book(25);
    book.applySnapshot(bookMessage(krakenBookSnapshotRaw));
    expect(book.top(2)).toEqual({
      bids: [
        { price: "0.9997", quantity: "3458455.09588324" },
        { price: "0.9996", quantity: "121278.21147528" }
      ],
      asks: [
        { price: "0.9998", quantity: "5764470.90836009" },
        { price: "0.9999", quantity: "511413.23906338" }
      ]
    });
    expect(book.applyUpdate(bookMessage(krakenBookUpdateRaw))).toEqual([
      {
        side: "bid",
        price: "0.9997",
        quantity: "3458427.6800536"
      }
    ]);
    expect(book.top(1).bids[0]?.quantity).toBe("3458427.6800536");
  });

  it("rejects checksum failures transactionally", () => {
    const book = new KrakenLevel2Book(25);
    book.applySnapshot(bookMessage(krakenBookSnapshotRaw));
    const before = book.top(1);
    expect(() =>
      book.applyUpdate({
        ...bookMessage(krakenBookUpdateRaw),
        data: [
          {
            ...bookMessage(krakenBookUpdateRaw).data[0]!,
            checksum: 1
          }
        ]
      })
    ).toThrowError(KrakenBookIntegrityError);
    expect(book.top(1)).toEqual(before);
  });

  it("rejects updates before snapshots, crossed books, and excess depth", () => {
    expect(() =>
      new KrakenLevel2Book(25).applyUpdate(
        bookMessage(krakenBookUpdateRaw)
      )
    ).toThrow(/before a snapshot/u);

    const snapshot = bookMessage(krakenBookSnapshotRaw);
    const tooDeep = new KrakenLevel2Book(10);
    expect(() =>
      tooDeep.applySnapshot({
        ...snapshot,
        data: [
          {
            ...snapshot.data[0]!,
            bids: [
              ...snapshot.data[0]!.bids,
              { price: "0.9987", qty: "1.00000000" }
            ]
          }
        ]
      })
    ).toThrow(/exceeded subscribed depth 10/u);
  });
});
