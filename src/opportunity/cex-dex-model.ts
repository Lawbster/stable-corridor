import type { NormalizedEvent } from "../collector/schema/events.js";

type BookCheckpointEvent = Extract<
  NormalizedEvent,
  { readonly eventType: "book_checkpoint" }
>;
type BookDeltaEvent = Extract<
  NormalizedEvent,
  { readonly eventType: "book_delta" }
>;
export type DexQuoteEvent = Extract<
  NormalizedEvent,
  { readonly eventType: "dex_quote" }
>;

export type CexDexDirection =
  | "buy_eurc_jupiter_sell_coinbase"
  | "buy_eurc_coinbase_sell_jupiter";

export interface CexDexCostModel {
  readonly coinbaseFeeBps: number;
  readonly modeledNetworkFeeUsdc: number;
  readonly executionBufferBps: number;
}

export interface CexDexEdgeSample {
  readonly key: string;
  readonly direction: CexDexDirection;
  readonly inputAmount: string;
  readonly receivedTimestampMs: number;
  readonly quoteLatencyMs: number;
  readonly quoteRequestId: string;
  readonly probe: DexQuoteEvent["payload"]["probe"];
  readonly router: string;
  readonly capitalUsdc: number;
  readonly coinbaseFeeNotionalUsdc: number;
  readonly zeroFeePnlUsdc: number;
  readonly grossEdgeBps: number;
  readonly modeledNetEdgeBps: number;
}

export class CoinbaseExecutableBook {
  readonly #bids = new Map<number, number>();
  readonly #asks = new Map<number, number>();
  #ready = false;

  get ready(): boolean {
    return this.#ready;
  }

  reset(event: BookCheckpointEvent): void {
    this.#bids.clear();
    this.#asks.clear();
    for (const level of event.payload.bids) {
      this.#set(this.#bids, level.price, level.quantity);
    }
    for (const level of event.payload.asks) {
      this.#set(this.#asks, level.price, level.quantity);
    }
    this.#ready = true;
  }

  apply(event: BookDeltaEvent): void {
    if (!this.#ready || event.payload.updateSemantics !== "absolute") {
      this.#ready = false;
      return;
    }
    for (const change of event.payload.changes) {
      this.#set(
        change.side === "bid" ? this.#bids : this.#asks,
        change.price,
        change.quantity
      );
    }
  }

  crossed(): boolean {
    const bid = this.#ordered(this.#bids, true)[0]?.[0];
    const ask = this.#ordered(this.#asks, false)[0]?.[0];
    return bid !== undefined && ask !== undefined && bid >= ask;
  }

  buyCost(quantity: number): number | null {
    return this.#fill(this.#ordered(this.#asks, false), quantity);
  }

  sellProceeds(quantity: number): number | null {
    return this.#fill(this.#ordered(this.#bids, true), quantity);
  }

  #set(side: Map<number, number>, price: string, quantity: string): void {
    const priceNumber = Number(price);
    const quantityNumber = Number(quantity);
    if (
      !Number.isFinite(priceNumber) ||
      priceNumber <= 0 ||
      !Number.isFinite(quantityNumber) ||
      quantityNumber < 0
    ) {
      this.#ready = false;
      return;
    }
    if (quantityNumber === 0) {
      side.delete(priceNumber);
    } else {
      side.set(priceNumber, quantityNumber);
    }
  }

  #ordered(
    side: ReadonlyMap<number, number>,
    descending: boolean
  ): readonly (readonly [number, number])[] {
    return [...side.entries()].sort(([left], [right]) =>
      descending ? right - left : left - right
    );
  }

  #fill(
    levels: readonly (readonly [number, number])[],
    requestedQuantity: number
  ): number | null {
    let remaining = requestedQuantity;
    let quoteAmount = 0;
    for (const [price, available] of levels) {
      const filled = Math.min(remaining, available);
      quoteAmount += filled * price;
      remaining -= filled;
      if (remaining <= 1e-9) {
        return quoteAmount;
      }
    }
    return null;
  }
}

export function modeledCexDexEdgeBps(
  sample: Pick<
    CexDexEdgeSample,
    "capitalUsdc" | "coinbaseFeeNotionalUsdc" | "zeroFeePnlUsdc"
  >,
  model: CexDexCostModel
): number {
  const fee =
    sample.coinbaseFeeNotionalUsdc *
    (model.coinbaseFeeBps / 10_000);
  return (
    ((sample.zeroFeePnlUsdc -
      fee -
      model.modeledNetworkFeeUsdc) /
      sample.capitalUsdc) *
      10_000 -
    model.executionBufferBps
  );
}

export function compareCoinbaseJupiterQuote(
  event: DexQuoteEvent,
  book: CoinbaseExecutableBook,
  model: CexDexCostModel
): CexDexEdgeSample | null {
  const inputAmount = Number(event.payload.inputAmount);
  const outputAmount = Number(event.payload.outputAmount);
  if (
    !Number.isFinite(inputAmount) ||
    inputAmount <= 0 ||
    !Number.isFinite(outputAmount) ||
    outputAmount <= 0
  ) {
    return null;
  }
  if (
    event.payload.inputAsset === "USDC" &&
    event.payload.outputAsset === "EURC"
  ) {
    const proceeds = book.sellProceeds(outputAmount);
    if (proceeds === null) {
      return null;
    }
    const zeroFeePnlUsdc = proceeds - inputAmount;
    const base = {
      key: `buy_eurc_jupiter_sell_coinbase|${event.payload.inputAmount}`,
      direction: "buy_eurc_jupiter_sell_coinbase" as const,
      inputAmount: event.payload.inputAmount,
      receivedTimestampMs: event.receivedTimestampMs,
      quoteLatencyMs: event.payload.quoteLatencyMs,
      quoteRequestId: event.payload.requestId,
      probe: event.payload.probe,
      router: event.payload.router,
      capitalUsdc: inputAmount,
      coinbaseFeeNotionalUsdc: proceeds,
      zeroFeePnlUsdc,
      grossEdgeBps: (zeroFeePnlUsdc / inputAmount) * 10_000
    };
    return {
      ...base,
      modeledNetEdgeBps: modeledCexDexEdgeBps(base, model)
    };
  }
  if (
    event.payload.inputAsset === "EURC" &&
    event.payload.outputAsset === "USDC"
  ) {
    const cost = book.buyCost(inputAmount);
    if (cost === null) {
      return null;
    }
    const zeroFeePnlUsdc = outputAmount - cost;
    const base = {
      key: `buy_eurc_coinbase_sell_jupiter|${event.payload.inputAmount}`,
      direction: "buy_eurc_coinbase_sell_jupiter" as const,
      inputAmount: event.payload.inputAmount,
      receivedTimestampMs: event.receivedTimestampMs,
      quoteLatencyMs: event.payload.quoteLatencyMs,
      quoteRequestId: event.payload.requestId,
      probe: event.payload.probe,
      router: event.payload.router,
      capitalUsdc: cost,
      coinbaseFeeNotionalUsdc: cost,
      zeroFeePnlUsdc,
      grossEdgeBps: (zeroFeePnlUsdc / cost) * 10_000
    };
    return {
      ...base,
      modeledNetEdgeBps: modeledCexDexEdgeBps(base, model)
    };
  }
  return null;
}
