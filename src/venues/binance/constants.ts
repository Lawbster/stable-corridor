export const BINANCE_PUBLIC_PRODUCTS = [
  "EURUSDC",
  "EURIUSDC",
  "USDCUSD"
] as const;

export type BinancePublicProduct =
  (typeof BINANCE_PUBLIC_PRODUCTS)[number];

export const BINANCE_PUBLIC_REST_BASE_URL =
  "https://data-api.binance.vision";

export const BINANCE_PUBLIC_WEBSOCKET_BASE_URL =
  "wss://data-stream.binance.vision";

export const BINANCE_DEPTH_SNAPSHOT_LIMIT = 1_000;

export const BINANCE_CANONICAL_PRODUCTS = {
  EURUSDC: "EUR-USDC",
  EURIUSDC: "EURI-USDC",
  USDCUSD: "USDC-USD"
} as const satisfies Record<BinancePublicProduct, string>;

const productSet = new Set<string>(BINANCE_PUBLIC_PRODUCTS);

export function isBinancePublicProduct(
  value: string
): value is BinancePublicProduct {
  return productSet.has(value);
}

export function assertBinancePublicProduct(
  value: string
): asserts value is BinancePublicProduct {
  if (!isBinancePublicProduct(value)) {
    throw new Error(`Unsupported Binance public product: ${value}`);
  }
}

export function binanceCanonicalProduct(
  product: BinancePublicProduct
): (typeof BINANCE_CANONICAL_PRODUCTS)[BinancePublicProduct] {
  return BINANCE_CANONICAL_PRODUCTS[product];
}

export function createBinancePublicStreamNames(
  products: readonly BinancePublicProduct[]
): readonly string[] {
  assertProductSet(products);
  return products.flatMap((product) => {
    const symbol = product.toLowerCase();
    return [`${symbol}@depth@100ms`, `${symbol}@trade`];
  });
}

export function createBinancePublicWebSocketUrl(
  products: readonly BinancePublicProduct[]
): string {
  const streams = createBinancePublicStreamNames(products);
  return `${BINANCE_PUBLIC_WEBSOCKET_BASE_URL}/stream?streams=${streams.join("/")}`;
}

export function assertBinanceProductSet(
  products: readonly BinancePublicProduct[]
): void {
  assertProductSet(products);
}

function assertProductSet(
  products: readonly BinancePublicProduct[]
): void {
  if (products.length === 0) {
    throw new Error("At least one Binance product is required");
  }
  if (new Set(products).size !== products.length) {
    throw new Error("Binance products must be unique");
  }
  for (const product of products) {
    assertBinancePublicProduct(product);
  }
}
