import {
  nonNegativeDecimalStringSchema,
  normalizeDecimalString,
  positiveDecimalStringSchema
} from "../../collector/schema/primitives.js";
import type { BybitOrderbookMessage } from "./schemas.js";

export type BybitBookIntegrityCode =
  | "crossed_book"
  | "duplicate_level"
  | "level_limit"
  | "missing_side"
  | "update_before_snapshot";

export class BybitBookIntegrityError extends Error {
  readonly code: BybitBookIntegrityCode;

  constructor(code: BybitBookIntegrityCode, message: string) {
    super(message);
    this.name = "BybitBookIntegrityError";
    this.code = code;
  }
}

export interface BybitBookLevel {
  readonly price: string;
  readonly quantity: string;
}

export interface BybitBookTop {
  readonly bids: readonly BybitBookLevel[];
  readonly asks: readonly BybitBookLevel[];
}

function splitDecimal(value: string): readonly [string, string] {
  const [integer = "0", fraction = ""] = value.split(".");
  return [integer, fraction];
}

export function compareBybitPositiveDecimals(
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

function copyLevels(levels: ReadonlyMap<string, string>): Map<string, string> {
  return new Map(levels);
}

export class BybitLevel2Book {
  readonly #maxLevelsPerSide: number;
  #bids = new Map<string, string>();
  #asks = new Map<string, string>();
  #initialized = false;

  constructor(maxLevelsPerSide: number) {
    if (
      !Number.isSafeInteger(maxLevelsPerSide) ||
      maxLevelsPerSide < 1
    ) {
      throw new Error(
        `Invalid Bybit maximum levels per side: ${maxLevelsPerSide}`
      );
    }
    this.#maxLevelsPerSide = maxLevelsPerSide;
  }

  get initialized(): boolean {
    return this.#initialized;
  }

  reset(): void {
    this.#bids = new Map();
    this.#asks = new Map();
    this.#initialized = false;
  }

  applySnapshot(message: BybitOrderbookMessage): void {
    const bids = this.#createSnapshotSide(message.data.b, "bid");
    const asks = this.#createSnapshotSide(message.data.a, "ask");
    this.#assertValidState(bids, asks);
    this.#bids = bids;
    this.#asks = asks;
    this.#initialized = true;
  }

  applyDelta(message: BybitOrderbookMessage): void {
    if (!this.#initialized) {
      throw new BybitBookIntegrityError(
        "update_before_snapshot",
        "Bybit orderbook delta arrived before a snapshot"
      );
    }
    const bids = copyLevels(this.#bids);
    const asks = copyLevels(this.#asks);
    this.#applyChanges(bids, message.data.b);
    this.#applyChanges(asks, message.data.a);
    this.#assertValidState(bids, asks);
    this.#bids = bids;
    this.#asks = asks;
  }

  top(depth: number): BybitBookTop {
    if (!this.#initialized) {
      throw new BybitBookIntegrityError(
        "update_before_snapshot",
        "Bybit book is not initialized"
      );
    }
    if (!Number.isSafeInteger(depth) || depth < 1) {
      throw new Error(`Invalid Bybit book depth: ${depth}`);
    }

    const bids = [...this.#bids.entries()]
      .sort(([left], [right]) =>
        compareBybitPositiveDecimals(right, left)
      )
      .slice(0, depth)
      .map(([price, quantity]) => ({ price, quantity }));
    const asks = [...this.#asks.entries()]
      .sort(([left], [right]) =>
        compareBybitPositiveDecimals(left, right)
      )
      .slice(0, depth)
      .map(([price, quantity]) => ({ price, quantity }));
    return { bids, asks };
  }

  #createSnapshotSide(
    input: readonly (readonly [string, string])[],
    side: "bid" | "ask"
  ): Map<string, string> {
    const levels = new Map<string, string>();
    for (const [rawPrice, rawQuantity] of input) {
      const price = positiveDecimalStringSchema.parse(
        normalizeDecimalString(rawPrice)
      );
      const quantity = nonNegativeDecimalStringSchema.parse(
        normalizeDecimalString(rawQuantity)
      );
      if (levels.has(price)) {
        throw new BybitBookIntegrityError(
          "duplicate_level",
          `Duplicate Bybit snapshot level ${side} ${price}`
        );
      }
      if (quantity !== "0") {
        levels.set(price, quantity);
      }
    }
    return levels;
  }

  #applyChanges(
    levels: Map<string, string>,
    changes: readonly (readonly [string, string])[]
  ): void {
    for (const [rawPrice, rawQuantity] of changes) {
      const price = positiveDecimalStringSchema.parse(
        normalizeDecimalString(rawPrice)
      );
      const quantity = nonNegativeDecimalStringSchema.parse(
        normalizeDecimalString(rawQuantity)
      );
      if (quantity === "0") {
        levels.delete(price);
      } else {
        levels.set(price, quantity);
      }
    }
  }

  #assertValidState(
    bids: ReadonlyMap<string, string>,
    asks: ReadonlyMap<string, string>
  ): void {
    if (bids.size === 0 || asks.size === 0) {
      throw new BybitBookIntegrityError(
        "missing_side",
        "Bybit book must contain at least one bid and one ask"
      );
    }
    if (
      bids.size > this.#maxLevelsPerSide ||
      asks.size > this.#maxLevelsPerSide
    ) {
      throw new BybitBookIntegrityError(
        "level_limit",
        `Bybit book exceeded ${this.#maxLevelsPerSide} levels per side`
      );
    }

    const bestBid = [...bids.keys()].reduce((best, price) =>
      compareBybitPositiveDecimals(price, best) > 0 ? price : best
    );
    const bestAsk = [...asks.keys()].reduce((best, price) =>
      compareBybitPositiveDecimals(price, best) < 0 ? price : best
    );
    if (compareBybitPositiveDecimals(bestBid, bestAsk) >= 0) {
      throw new BybitBookIntegrityError(
        "crossed_book",
        `Bybit book is crossed: best bid ${bestBid}, best ask ${bestAsk}`
      );
    }
  }
}
