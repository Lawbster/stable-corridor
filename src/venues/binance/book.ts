import {
  nonNegativeDecimalStringSchema,
  normalizeDecimalString,
  positiveDecimalStringSchema
} from "../../collector/schema/primitives.js";
import type {
  BinanceDepthSnapshot,
  BinanceDepthUpdate
} from "./schemas.js";

export type BinanceBookIntegrityCode =
  | "crossed_book"
  | "duplicate_level"
  | "level_limit"
  | "missing_side"
  | "update_before_snapshot";

export class BinanceBookIntegrityError extends Error {
  readonly code: BinanceBookIntegrityCode;

  constructor(code: BinanceBookIntegrityCode, message: string) {
    super(message);
    this.name = "BinanceBookIntegrityError";
    this.code = code;
  }
}

export interface BinanceBookLevel {
  readonly price: string;
  readonly quantity: string;
}

export interface BinanceBookTop {
  readonly bids: readonly BinanceBookLevel[];
  readonly asks: readonly BinanceBookLevel[];
}

function splitDecimal(value: string): readonly [string, string] {
  const [integer = "0", fraction = ""] = value.split(".");
  return [integer, fraction];
}

export function compareBinancePositiveDecimals(
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

export class BinanceLevel2Book {
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
        `Invalid Binance maximum levels per side: ${maxLevelsPerSide}`
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

  applySnapshot(snapshot: BinanceDepthSnapshot): void {
    const bids = this.#createSnapshotSide(snapshot.bids, "bid");
    const asks = this.#createSnapshotSide(snapshot.asks, "ask");
    this.#assertValidState(bids, asks);
    this.#bids = bids;
    this.#asks = asks;
    this.#initialized = true;
  }

  applyUpdate(event: BinanceDepthUpdate): void {
    if (!this.#initialized) {
      throw new BinanceBookIntegrityError(
        "update_before_snapshot",
        "Binance depth update arrived before a snapshot"
      );
    }

    const bids = copyLevels(this.#bids);
    const asks = copyLevels(this.#asks);
    this.#applyChanges(bids, event.b);
    this.#applyChanges(asks, event.a);
    this.#assertValidState(bids, asks);
    this.#bids = bids;
    this.#asks = asks;
  }

  top(depth: number): BinanceBookTop {
    if (!this.#initialized) {
      throw new BinanceBookIntegrityError(
        "update_before_snapshot",
        "Binance book is not initialized"
      );
    }
    if (!Number.isSafeInteger(depth) || depth < 1) {
      throw new Error(`Invalid Binance book depth: ${depth}`);
    }

    const bids = [...this.#bids.entries()]
      .sort(([left], [right]) =>
        compareBinancePositiveDecimals(right, left)
      )
      .slice(0, depth)
      .map(([price, quantity]) => ({ price, quantity }));
    const asks = [...this.#asks.entries()]
      .sort(([left], [right]) =>
        compareBinancePositiveDecimals(left, right)
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
        throw new BinanceBookIntegrityError(
          "duplicate_level",
          `Duplicate Binance snapshot level ${side} ${price}`
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
      throw new BinanceBookIntegrityError(
        "missing_side",
        "Binance book must contain at least one bid and one ask"
      );
    }
    if (
      bids.size > this.#maxLevelsPerSide ||
      asks.size > this.#maxLevelsPerSide
    ) {
      throw new BinanceBookIntegrityError(
        "level_limit",
        `Binance book exceeded ${this.#maxLevelsPerSide} levels per side`
      );
    }

    const bestBid = [...bids.keys()].reduce((best, price) =>
      compareBinancePositiveDecimals(price, best) > 0 ? price : best
    );
    const bestAsk = [...asks.keys()].reduce((best, price) =>
      compareBinancePositiveDecimals(price, best) < 0 ? price : best
    );
    if (compareBinancePositiveDecimals(bestBid, bestAsk) >= 0) {
      throw new BinanceBookIntegrityError(
        "crossed_book",
        `Binance book is crossed: best bid ${bestBid}, best ask ${bestAsk}`
      );
    }
  }
}
