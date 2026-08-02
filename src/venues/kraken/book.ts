import {
  nonNegativeDecimalStringSchema,
  normalizeDecimalString,
  positiveDecimalStringSchema
} from "../../collector/schema/primitives.js";
import { calculateKrakenBookChecksum } from "./checksum.js";
import type { KrakenBookMessage } from "./schemas.js";

export type KrakenBookIntegrityCode =
  | "checksum_mismatch"
  | "crossed_book"
  | "duplicate_level"
  | "level_limit"
  | "missing_side"
  | "update_before_snapshot";

export class KrakenBookIntegrityError extends Error {
  readonly code: KrakenBookIntegrityCode;

  constructor(code: KrakenBookIntegrityCode, message: string) {
    super(message);
    this.name = "KrakenBookIntegrityError";
    this.code = code;
  }
}

interface StoredLevel {
  readonly price: string;
  readonly quantity: string;
  readonly rawPrice: string;
  readonly rawQuantity: string;
}

export interface KrakenBookLevel {
  readonly price: string;
  readonly quantity: string;
}

export interface KrakenBookTop {
  readonly bids: readonly KrakenBookLevel[];
  readonly asks: readonly KrakenBookLevel[];
}

export interface KrakenAppliedBookChange {
  readonly side: "bid" | "ask";
  readonly price: string;
  readonly quantity: string;
}

function splitDecimal(value: string): readonly [string, string] {
  const [integer = "0", fraction = ""] = value.split(".");
  return [integer, fraction];
}

export function compareKrakenPositiveDecimals(
  left: string,
  right: string
): number {
  const normalizedLeft = normalizeDecimalString(left);
  const normalizedRight = normalizeDecimalString(right);
  const [leftInteger, leftFraction] = splitDecimal(normalizedLeft);
  const [rightInteger, rightFraction] = splitDecimal(normalizedRight);
  if (leftInteger.length !== rightInteger.length) {
    return leftInteger.length < rightInteger.length ? -1 : 1;
  }
  if (leftInteger !== rightInteger) {
    return leftInteger < rightInteger ? -1 : 1;
  }
  const fractionLength = Math.max(
    leftFraction.length,
    rightFraction.length
  );
  const paddedLeft = leftFraction.padEnd(fractionLength, "0");
  const paddedRight = rightFraction.padEnd(fractionLength, "0");
  if (paddedLeft === paddedRight) {
    return 0;
  }
  return paddedLeft < paddedRight ? -1 : 1;
}

function copySide(
  levels: ReadonlyMap<string, StoredLevel>
): Map<string, StoredLevel> {
  return new Map(levels);
}

export class KrakenLevel2Book {
  readonly #depth: number;
  #bids = new Map<string, StoredLevel>();
  #asks = new Map<string, StoredLevel>();
  #initialized = false;

  constructor(depth: number) {
    if (!Number.isSafeInteger(depth) || depth < 10 || depth > 1_000) {
      throw new Error(`Invalid Kraken book depth: ${depth}`);
    }
    this.#depth = depth;
  }

  get initialized(): boolean {
    return this.#initialized;
  }

  reset(): void {
    this.#bids = new Map();
    this.#asks = new Map();
    this.#initialized = false;
  }

  applySnapshot(message: KrakenBookMessage): void {
    const data = message.data[0]!;
    const bids = this.#createSnapshotSide(data.bids, "bid");
    const asks = this.#createSnapshotSide(data.asks, "ask");
    this.#assertValidState(bids, asks);
    this.#assertChecksum(bids, asks, data.checksum);
    this.#bids = bids;
    this.#asks = asks;
    this.#initialized = true;
  }

  applyUpdate(
    message: KrakenBookMessage
  ): readonly KrakenAppliedBookChange[] {
    if (!this.#initialized) {
      throw new KrakenBookIntegrityError(
        "update_before_snapshot",
        "Kraken book update arrived before a snapshot"
      );
    }
    const data = message.data[0]!;
    const bids = copySide(this.#bids);
    const asks = copySide(this.#asks);
    const changes: KrakenAppliedBookChange[] = [];
    this.#applyChanges(bids, data.bids, "bid", changes);
    this.#applyChanges(asks, data.asks, "ask", changes);
    this.#trimSide(bids, "bid", changes);
    this.#trimSide(asks, "ask", changes);
    this.#assertValidState(bids, asks);
    this.#assertChecksum(bids, asks, data.checksum);
    this.#bids = bids;
    this.#asks = asks;
    return changes;
  }

  top(depth: number): KrakenBookTop {
    if (!this.#initialized) {
      throw new KrakenBookIntegrityError(
        "update_before_snapshot",
        "Kraken book is not initialized"
      );
    }
    if (
      !Number.isSafeInteger(depth) ||
      depth < 1 ||
      depth > this.#depth
    ) {
      throw new Error(`Invalid Kraken requested book depth: ${depth}`);
    }
    return {
      bids: this.#sorted(this.#bids, "bid")
        .slice(0, depth)
        .map((level) => ({
          price: level.price,
          quantity: level.quantity
        })),
      asks: this.#sorted(this.#asks, "ask")
        .slice(0, depth)
        .map((level) => ({
          price: level.price,
          quantity: level.quantity
        }))
    };
  }

  #createSnapshotSide(
    input: readonly {
      readonly price: string;
      readonly qty: string;
    }[],
    side: "bid" | "ask"
  ): Map<string, StoredLevel> {
    if (input.length > this.#depth) {
      throw new KrakenBookIntegrityError(
        "level_limit",
        `Kraken snapshot exceeded subscribed depth ${this.#depth}`
      );
    }
    const levels = new Map<string, StoredLevel>();
    for (const update of input) {
      const level = this.#level(update.price, update.qty);
      if (levels.has(level.price)) {
        throw new KrakenBookIntegrityError(
          "duplicate_level",
          `Duplicate Kraken snapshot level ${side} ${level.price}`
        );
      }
      if (level.quantity !== "0") {
        levels.set(level.price, level);
      }
    }
    return levels;
  }

  #applyChanges(
    levels: Map<string, StoredLevel>,
    input: readonly {
      readonly price: string;
      readonly qty: string;
    }[],
    side: "bid" | "ask",
    output: KrakenAppliedBookChange[]
  ): void {
    for (const update of input) {
      const level = this.#level(update.price, update.qty);
      if (level.quantity === "0") {
        levels.delete(level.price);
      } else {
        levels.set(level.price, level);
      }
      output.push({
        side,
        price: level.price,
        quantity: level.quantity
      });
    }
  }

  #trimSide(
    levels: Map<string, StoredLevel>,
    side: "bid" | "ask",
    output: KrakenAppliedBookChange[]
  ): void {
    const sorted = this.#sorted(levels, side);
    for (const level of sorted.slice(this.#depth)) {
      levels.delete(level.price);
      output.push({
        side,
        price: level.price,
        quantity: "0"
      });
    }
  }

  #level(rawPrice: string, rawQuantity: string): StoredLevel {
    const price = positiveDecimalStringSchema.parse(
      normalizeDecimalString(rawPrice)
    );
    const quantity = nonNegativeDecimalStringSchema.parse(
      normalizeDecimalString(rawQuantity)
    );
    return {
      price,
      quantity,
      rawPrice,
      rawQuantity
    };
  }

  #sorted(
    levels: ReadonlyMap<string, StoredLevel>,
    side: "bid" | "ask"
  ): StoredLevel[] {
    return [...levels.values()].sort((left, right) =>
      side === "bid"
        ? compareKrakenPositiveDecimals(right.price, left.price)
        : compareKrakenPositiveDecimals(left.price, right.price)
    );
  }

  #assertValidState(
    bids: ReadonlyMap<string, StoredLevel>,
    asks: ReadonlyMap<string, StoredLevel>
  ): void {
    if (bids.size === 0 || asks.size === 0) {
      throw new KrakenBookIntegrityError(
        "missing_side",
        "Kraken book must contain at least one bid and one ask"
      );
    }
    if (bids.size > this.#depth || asks.size > this.#depth) {
      throw new KrakenBookIntegrityError(
        "level_limit",
        `Kraken book exceeded subscribed depth ${this.#depth}`
      );
    }
    const bestBid = this.#sorted(bids, "bid")[0]!;
    const bestAsk = this.#sorted(asks, "ask")[0]!;
    if (
      compareKrakenPositiveDecimals(
        bestBid.price,
        bestAsk.price
      ) >= 0
    ) {
      throw new KrakenBookIntegrityError(
        "crossed_book",
        `Kraken book is crossed: ${bestBid.price}/${bestAsk.price}`
      );
    }
  }

  #assertChecksum(
    bids: ReadonlyMap<string, StoredLevel>,
    asks: ReadonlyMap<string, StoredLevel>,
    expected: number
  ): void {
    const actual = calculateKrakenBookChecksum({
      bids: this.#sorted(bids, "bid").map((level) => ({
        price: level.rawPrice,
        quantity: level.rawQuantity
      })),
      asks: this.#sorted(asks, "ask").map((level) => ({
        price: level.rawPrice,
        quantity: level.rawQuantity
      }))
    });
    if (actual !== expected) {
      throw new KrakenBookIntegrityError(
        "checksum_mismatch",
        `Kraken checksum mismatch: expected ${expected}, calculated ${actual}`
      );
    }
  }
}
