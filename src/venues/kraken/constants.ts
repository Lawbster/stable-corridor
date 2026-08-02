export const KRAKEN_PUBLIC_PRODUCTS = [
  "EURC/USDC",
  "EURC/EUR",
  "EURC/USD",
  "USDC/EUR",
  "USDC/USD"
] as const;

export type KrakenPublicProduct =
  (typeof KRAKEN_PUBLIC_PRODUCTS)[number];

export const KRAKEN_PUBLIC_REST_BASE_URL = "https://api.kraken.com";
export const KRAKEN_PUBLIC_WEBSOCKET_URL = "wss://ws.kraken.com/v2";
export const KRAKEN_BOOK_DEPTH = 25;
export const KRAKEN_BOOK_SUBSCRIPTION_REQUEST_ID = 301;
export const KRAKEN_TRADE_SUBSCRIPTION_REQUEST_ID = 302;

export const KRAKEN_CANONICAL_PRODUCTS = {
  "EURC/USDC": "EURC-USDC",
  "EURC/EUR": "EURC-EUR",
  "EURC/USD": "EURC-USD",
  "USDC/EUR": "USDC-EUR",
  "USDC/USD": "USDC-USD"
} as const satisfies Record<KrakenPublicProduct, string>;

export const KRAKEN_REST_PRODUCTS = {
  "EURC/USDC": "EURCUSDC",
  "EURC/EUR": "EURCEUR",
  "EURC/USD": "EURCUSD",
  "USDC/EUR": "USDCEUR",
  "USDC/USD": "USDCUSD"
} as const satisfies Record<KrakenPublicProduct, string>;

const productSet = new Set<string>(KRAKEN_PUBLIC_PRODUCTS);

export function isKrakenPublicProduct(
  value: string
): value is KrakenPublicProduct {
  return productSet.has(value);
}

export function assertKrakenPublicProduct(
  value: string
): asserts value is KrakenPublicProduct {
  if (!isKrakenPublicProduct(value)) {
    throw new Error(`Unsupported Kraken public product: ${value}`);
  }
}

export function assertKrakenProductSet(
  products: readonly KrakenPublicProduct[]
): void {
  if (products.length === 0) {
    throw new Error("At least one Kraken product is required");
  }
  if (new Set(products).size !== products.length) {
    throw new Error("Kraken products must be unique");
  }
  for (const product of products) {
    assertKrakenPublicProduct(product);
  }
}

export function krakenCanonicalProduct(
  product: KrakenPublicProduct
): (typeof KRAKEN_CANONICAL_PRODUCTS)[KrakenPublicProduct] {
  return KRAKEN_CANONICAL_PRODUCTS[product];
}

export interface KrakenSubscriptionMessage {
  readonly method: "subscribe";
  readonly params:
    | {
        readonly channel: "book";
        readonly symbol: readonly KrakenPublicProduct[];
        readonly depth: typeof KRAKEN_BOOK_DEPTH;
        readonly snapshot: true;
      }
    | {
        readonly channel: "trade";
        readonly symbol: readonly KrakenPublicProduct[];
        readonly snapshot: false;
      };
  readonly req_id: number;
}

export function createKrakenSubscriptionMessages(
  products: readonly KrakenPublicProduct[]
): readonly KrakenSubscriptionMessage[] {
  assertKrakenProductSet(products);
  return [
    {
      method: "subscribe",
      params: {
        channel: "book",
        symbol: [...products],
        depth: KRAKEN_BOOK_DEPTH,
        snapshot: true
      },
      req_id: KRAKEN_BOOK_SUBSCRIPTION_REQUEST_ID
    },
    {
      method: "subscribe",
      params: {
        channel: "trade",
        symbol: [...products],
        snapshot: false
      },
      req_id: KRAKEN_TRADE_SUBSCRIPTION_REQUEST_ID
    }
  ];
}
