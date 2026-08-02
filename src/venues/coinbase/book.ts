import {
  nonNegativeDecimalStringSchema,
  normalizeDecimalString,
  positiveDecimalStringSchema
} from "../../collector/schema/primitives.js";
import type { CoinbaseLevel2Update } from "./schemas.js";

export type CoinbaseBookIntegrityCode =
  | "crossed_book"
  | "duplicate_level"
  | "level_limit"
  | "missing_side"
  | "update_before_snapshot";

export class CoinbaseBookIntegrityError extends Error {
  readonly code: CoinbaseBookIntegrityCode;

  constructor(code: CoinbaseBookIntegrityCode, message: string) {
    super(message);
    this.name = "CoinbaseBookIntegrityError";
    this.code = code;
  }
}

export interface CoinbaseBookLevel {
  readonly price: string;
  readonly quantity: string;
}

export interface CoinbaseBookTop {
  readonly bids: readonly CoinbaseBookLevel[];
  readonly asks: readonly CoinbaseBookLevel[];
}

function splitDecimal(value: string): readonly [string, string] {
  const [integer = "0", fraction = ""] = value.split(".");
  return [integer, fraction];
}

export function compareCanonicalPositiveDecimals(
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

export class CoinbaseLevel2Book {
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
        `Invalid Coinbase maximum levels per side: ${maxLevelsPerSide}`
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

  applySnapshot(updates: readonly CoinbaseLevel2Update[]): void {
    const bids = new Map<string, string>();
    const asks = new Map<string, string>();

    for (const update of updates) {
      const levels = update.side === "bid" ? bids : asks;
      const price = positiveDecimalStringSchema.parse(
        normalizeDecimalString(update.price_level)
      );
      const quantity = nonNegativeDecimalStringSchema.parse(
        normalizeDecimalString(update.new_quantity)
      );

      if (levels.has(price)) {
        throw new CoinbaseBookIntegrityError(
          "duplicate_level",
          `Duplicate Coinbase snapshot level ${update.side} ${price}`
        );
      }
      if (quantity !== "0") {
        levels.set(price, quantity);
      }
    }

    this.#assertValidState(bids, asks);
    this.#bids = bids;
    this.#asks = asks;
    this.#initialized = true;
  }

  applyUpdate(updates: readonly CoinbaseLevel2Update[]): void {
    if (!this.#initialized) {
      throw new CoinbaseBookIntegrityError(
        "update_before_snapshot",
        "Coinbase level2 update arrived before a snapshot"
      );
    }

    const bids = copyLevels(this.#bids);
    const asks = copyLevels(this.#asks);

    for (const update of updates) {
      const levels = update.side === "bid" ? bids : asks;
      const price = positiveDecimalStringSchema.parse(
        normalizeDecimalString(update.price_level)
      );
      const quantity = nonNegativeDecimalStringSchema.parse(
        normalizeDecimalString(update.new_quantity)
      );

      if (quantity === "0") {
        levels.delete(price);
      } else {
        levels.set(price, quantity);
      }
    }

    this.#assertValidState(bids, asks);
    this.#bids = bids;
    this.#asks = asks;
  }

  top(depth: number): CoinbaseBookTop {
    if (!this.#initialized) {
      throw new CoinbaseBookIntegrityError(
        "update_before_snapshot",
        "Coinbase book is not initialized"
      );
    }
    if (!Number.isSafeInteger(depth) || depth < 1) {
      throw new Error(`Invalid Coinbase book depth: ${depth}`);
    }

    const bids = [...this.#bids.entries()]
      .sort(([left], [right]) =>
        compareCanonicalPositiveDecimals(right, left)
      )
      .slice(0, depth)
      .map(([price, quantity]) => ({ price, quantity }));
    const asks = [...this.#asks.entries()]
      .sort(([left], [right]) =>
        compareCanonicalPositiveDecimals(left, right)
      )
      .slice(0, depth)
      .map(([price, quantity]) => ({ price, quantity }));

    return { bids, asks };
  }

  #assertValidState(
    bids: ReadonlyMap<string, string>,
    asks: ReadonlyMap<string, string>
  ): void {
    if (bids.size === 0 || asks.size === 0) {
      throw new CoinbaseBookIntegrityError(
        "missing_side",
        "Coinbase book must contain at least one bid and one ask"
      );
    }
    if (
      bids.size > this.#maxLevelsPerSide ||
      asks.size > this.#maxLevelsPerSide
    ) {
      throw new CoinbaseBookIntegrityError(
        "level_limit",
        `Coinbase book exceeded ${this.#maxLevelsPerSide} levels per side`
      );
    }

    const bestBid = [...bids.keys()].reduce((best, price) =>
      compareCanonicalPositiveDecimals(price, best) > 0 ? price : best
    );
    const bestAsk = [...asks.keys()].reduce((best, price) =>
      compareCanonicalPositiveDecimals(price, best) < 0 ? price : best
    );

    if (compareCanonicalPositiveDecimals(bestBid, bestAsk) >= 0) {
      throw new CoinbaseBookIntegrityError(
        "crossed_book",
        `Coinbase book is crossed: best bid ${bestBid}, best ask ${bestAsk}`
      );
    }
  }
}
