export const BYBIT_PUBLIC_PRODUCTS = [
  "USDTEUR",
  "USDCEUR",
  "USDCUSDT"
] as const;

export type BybitPublicProduct =
  (typeof BYBIT_PUBLIC_PRODUCTS)[number];

export const BYBIT_PUBLIC_REST_BASE_URL = "https://api.bybit.com";

export const BYBIT_PUBLIC_SPOT_WEBSOCKET_URL =
  "wss://stream.bybit.com/v5/public/spot";

export const BYBIT_ORDERBOOK_DEPTH = 200;

export const BYBIT_CANONICAL_PRODUCTS = {
  USDTEUR: "USDT-EUR",
  USDCEUR: "USDC-EUR",
  USDCUSDT: "USDC-USDT"
} as const satisfies Record<BybitPublicProduct, string>;

const productSet = new Set<string>(BYBIT_PUBLIC_PRODUCTS);

export function isBybitPublicProduct(
  value: string
): value is BybitPublicProduct {
  return productSet.has(value);
}

export function assertBybitPublicProduct(
  value: string
): asserts value is BybitPublicProduct {
  if (!isBybitPublicProduct(value)) {
    throw new Error(`Unsupported Bybit public product: ${value}`);
  }
}

export function assertBybitProductSet(
  products: readonly BybitPublicProduct[]
): void {
  if (products.length === 0) {
    throw new Error("At least one Bybit product is required");
  }
  if (new Set(products).size !== products.length) {
    throw new Error("Bybit products must be unique");
  }
  for (const product of products) {
    assertBybitPublicProduct(product);
  }
}

export function bybitCanonicalProduct(
  product: BybitPublicProduct
): (typeof BYBIT_CANONICAL_PRODUCTS)[BybitPublicProduct] {
  return BYBIT_CANONICAL_PRODUCTS[product];
}

export function createBybitPublicTopics(
  products: readonly BybitPublicProduct[]
): readonly string[] {
  assertBybitProductSet(products);
  return products.flatMap((product) => [
    `orderbook.${BYBIT_ORDERBOOK_DEPTH}.${product}`,
    `publicTrade.${product}`
  ]);
}

export interface BybitSubscriptionMessage {
  readonly req_id: "stable-corridor-public-subscribe";
  readonly op: "subscribe";
  readonly args: readonly string[];
}

export function createBybitSubscriptionMessage(
  products: readonly BybitPublicProduct[]
): BybitSubscriptionMessage {
  return {
    req_id: "stable-corridor-public-subscribe",
    op: "subscribe",
    args: createBybitPublicTopics(products)
  };
}

export interface BybitPingMessage {
  readonly op: "ping";
}

export function createBybitPingMessage(): BybitPingMessage {
  return { op: "ping" };
}
