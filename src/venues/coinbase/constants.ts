export const COINBASE_PUBLIC_PRODUCTS = [
  "EURC-USDC",
  "USDC-EUR"
] as const;

export type CoinbasePublicProduct =
  (typeof COINBASE_PUBLIC_PRODUCTS)[number];

export const COINBASE_ADVANCED_PUBLIC_WEBSOCKET_URL =
  "wss://advanced-trade-ws.coinbase.com";

export const COINBASE_ADVANCED_PUBLIC_REST_BASE_URL =
  "https://api.coinbase.com/api/v3/brokerage/market";

export const COINBASE_PUBLIC_CHANNELS = [
  "level2",
  "market_trades",
  "status",
  "heartbeats"
] as const;

const productSet = new Set<string>(COINBASE_PUBLIC_PRODUCTS);

export function isCoinbasePublicProduct(
  value: string
): value is CoinbasePublicProduct {
  return productSet.has(value);
}

export function assertCoinbasePublicProduct(
  value: string
): asserts value is CoinbasePublicProduct {
  if (!isCoinbasePublicProduct(value)) {
    throw new Error(`Unsupported Coinbase public product: ${value}`);
  }
}

export interface CoinbaseSubscriptionMessage {
  readonly type: "subscribe";
  readonly product_ids: readonly CoinbasePublicProduct[];
  readonly channel: (typeof COINBASE_PUBLIC_CHANNELS)[number];
}

export function createCoinbaseSubscriptionMessages(
  products: readonly CoinbasePublicProduct[]
): readonly CoinbaseSubscriptionMessage[] {
  if (products.length === 0) {
    throw new Error("At least one Coinbase product is required");
  }
  if (new Set(products).size !== products.length) {
    throw new Error("Coinbase products must be unique");
  }

  return COINBASE_PUBLIC_CHANNELS.map((channel) => ({
    type: "subscribe",
    product_ids: [...products],
    channel
  }));
}
