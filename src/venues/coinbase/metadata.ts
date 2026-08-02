import {
  instrumentEventSchema,
  type NormalizedEvent
} from "../../collector/schema/events.js";
import {
  collectorRunIdSchema,
  connectionIdSchema,
  normalizeDecimalString,
  utcEpochMillisecondsSchema
} from "../../collector/schema/primitives.js";
import {
  assertCoinbasePublicProduct,
  COINBASE_ADVANCED_PUBLIC_REST_BASE_URL,
  type CoinbasePublicProduct
} from "./constants.js";
import {
  coinbaseAdvancedProductSchema,
  type CoinbaseAdvancedProduct
} from "./schemas.js";

export type CoinbaseInstrumentEvent = Extract<
  NormalizedEvent,
  { readonly eventType: "instrument" }
>;

export interface CoinbaseMetadataContext {
  readonly receivedTimestampMs: number;
  readonly ingestSequence: number;
  readonly collectorRunId: string;
  readonly connectionId: string;
}

export interface CoinbasePublicFetchOptions {
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}

function mapProductStatus(
  product: CoinbaseAdvancedProduct
): CoinbaseInstrumentEvent["payload"]["status"] {
  if (product.trading_disabled || product.view_only) {
    return "offline";
  }
  if (product.cancel_only) {
    return "cancel_only";
  }
  if (product.post_only) {
    return "post_only";
  }
  if (product.limit_only) {
    return "limit_only";
  }
  if (product.status === "online") {
    return "online";
  }
  if (product.status === "offline" || product.status === "delisted") {
    return "offline";
  }
  return "unknown";
}

export function normalizeCoinbaseProductMetadata(
  input: unknown,
  context: CoinbaseMetadataContext
): CoinbaseInstrumentEvent {
  const product = coinbaseAdvancedProductSchema.parse(input);
  const receivedTimestampMs = utcEpochMillisecondsSchema.parse(
    context.receivedTimestampMs
  );
  const collectorRunId = collectorRunIdSchema.parse(context.collectorRunId);
  const connectionId = connectionIdSchema.parse(context.connectionId);

  if (product.product_type !== "SPOT") {
    throw new Error(
      `Coinbase product ${product.product_id} is not spot: ${product.product_type}`
    );
  }

  return instrumentEventSchema.parse({
    schemaVersion: 1,
    eventType: "instrument",
    venue: "coinbase",
    product: product.product_id,
    nativeProduct: product.product_id,
    sourceTimestampMs: null,
    receivedTimestampMs,
    ingestSequence: context.ingestSequence,
    collectorRunId,
    connectionId,
    venueSequence: null,
    source: "rest",
    payload: {
      baseAsset: product.base_currency_id,
      quoteAsset: product.quote_currency_id,
      status: mapProductStatus(product),
      tickSize: normalizeDecimalString(product.quote_increment),
      quantityStep: normalizeDecimalString(product.base_increment),
      minimumQuantity: normalizeDecimalString(product.base_min_size),
      maximumQuantity: normalizeDecimalString(product.base_max_size),
      minimumNotional: normalizeDecimalString(product.quote_min_size),
      maximumNotional: normalizeDecimalString(product.quote_max_size),
      observedAtMs: receivedTimestampMs
    }
  });
}

export async function fetchCoinbasePublicProductMetadata(
  product: CoinbasePublicProduct,
  options: CoinbasePublicFetchOptions = {}
): Promise<CoinbaseAdvancedProduct> {
  assertCoinbasePublicProduct(product);
  const fetchImpl = options.fetchImpl ?? fetch;
  const url =
    `${COINBASE_ADVANCED_PUBLIC_REST_BASE_URL}/products/` +
    encodeURIComponent(product);
  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      "cache-control": "no-cache"
    },
    ...(options.signal === undefined ? {} : { signal: options.signal })
  });

  if (!response.ok) {
    throw new Error(
      `Coinbase public product request failed for ${product}: HTTP ${response.status}`
    );
  }

  return coinbaseAdvancedProductSchema.parse(await response.json());
}

export async function fetchCoinbasePublicProductsMetadata(
  products: readonly CoinbasePublicProduct[],
  options: CoinbasePublicFetchOptions = {}
): Promise<readonly CoinbaseAdvancedProduct[]> {
  if (products.length === 0) {
    throw new Error("At least one Coinbase product is required");
  }
  if (new Set(products).size !== products.length) {
    throw new Error("Coinbase products must be unique");
  }

  return Promise.all(
    products.map((product) =>
      fetchCoinbasePublicProductMetadata(product, options)
    )
  );
}
