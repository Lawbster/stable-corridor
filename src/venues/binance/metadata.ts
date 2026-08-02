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
  assertBinanceProductSet,
  assertBinancePublicProduct,
  binanceCanonicalProduct,
  BINANCE_DEPTH_SNAPSHOT_LIMIT,
  BINANCE_PUBLIC_REST_BASE_URL,
  type BinancePublicProduct
} from "./constants.js";
import {
  binanceDepthSnapshotSchema,
  binanceExchangeInfoSchema,
  binanceSymbolInfoSchema,
  type BinanceDepthSnapshot,
  type BinanceExchangeInfo,
  type BinanceSymbolFilter,
  type BinanceSymbolInfo
} from "./schemas.js";

export type BinanceInstrumentEvent = Extract<
  NormalizedEvent,
  { readonly eventType: "instrument" }
>;

export interface BinanceMetadataContext {
  readonly receivedTimestampMs: number;
  readonly ingestSequence: number;
  readonly collectorRunId: string;
  readonly connectionId: string;
  readonly serverTimeMs: number;
}

export interface BinancePublicFetchOptions {
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly maxResponseBytes?: number;
}

const DEFAULT_MAX_REST_RESPONSE_BYTES = 2 * 1024 * 1024;

function requiredFilter(
  product: BinancePublicProduct,
  filters: readonly BinanceSymbolFilter[],
  filterTypes: readonly string[]
): BinanceSymbolFilter {
  const filter = filters.find((candidate) =>
    filterTypes.includes(candidate.filterType)
  );
  if (filter === undefined) {
    throw new Error(
      `Binance product ${product} lacks ${filterTypes.join("/")} filter`
    );
  }
  return filter;
}

function requiredDecimal(
  product: BinancePublicProduct,
  filter: BinanceSymbolFilter,
  field: keyof BinanceSymbolFilter
): string {
  const value = filter[field];
  if (typeof value !== "string") {
    throw new Error(
      `Binance product ${product} filter ${filter.filterType} lacks ${field}`
    );
  }
  return normalizeDecimalString(value);
}

function nullablePositive(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const normalized = normalizeDecimalString(value);
  return normalized === "0" ? null : normalized;
}

function mapStatus(
  product: BinanceSymbolInfo
): BinanceInstrumentEvent["payload"]["status"] {
  if (!product.isSpotTradingAllowed) {
    return "offline";
  }
  if (product.status === "TRADING") {
    return "online";
  }
  if (product.status === "HALT" || product.status === "BREAK") {
    return "offline";
  }
  return "unknown";
}

export function normalizeBinanceProductMetadata(
  input: unknown,
  context: BinanceMetadataContext
): BinanceInstrumentEvent {
  const product = binanceSymbolInfoSchema.parse(input);
  const receivedTimestampMs = utcEpochMillisecondsSchema.parse(
    context.receivedTimestampMs
  );
  const sourceTimestampMs = utcEpochMillisecondsSchema.parse(
    context.serverTimeMs
  );
  const collectorRunId = collectorRunIdSchema.parse(context.collectorRunId);
  const connectionId = connectionIdSchema.parse(context.connectionId);
  const priceFilter = requiredFilter(product.symbol, product.filters, [
    "PRICE_FILTER"
  ]);
  const lotSizeFilter = requiredFilter(product.symbol, product.filters, [
    "LOT_SIZE"
  ]);
  const notionalFilter = requiredFilter(product.symbol, product.filters, [
    "NOTIONAL",
    "MIN_NOTIONAL"
  ]);

  const expectedAssets: Record<
    BinancePublicProduct,
    readonly [string, string]
  > = {
    EURUSDC: ["EUR", "USDC"],
    EURIUSDC: ["EURI", "USDC"],
    USDCUSD: ["USDC", "USD"]
  };
  const [expectedBase, expectedQuote] = expectedAssets[product.symbol];
  if (
    product.baseAsset !== expectedBase ||
    product.quoteAsset !== expectedQuote
  ) {
    throw new Error(
      `Binance product ${product.symbol} asset mapping changed: ` +
        `${product.baseAsset}/${product.quoteAsset}`
    );
  }

  return instrumentEventSchema.parse({
    schemaVersion: 1,
    eventType: "instrument",
    venue: "binance",
    product: binanceCanonicalProduct(product.symbol),
    nativeProduct: product.symbol,
    sourceTimestampMs,
    receivedTimestampMs,
    ingestSequence: context.ingestSequence,
    collectorRunId,
    connectionId,
    venueSequence: null,
    source: "rest",
    payload: {
      baseAsset: product.baseAsset,
      quoteAsset: product.quoteAsset,
      status: mapStatus(product),
      tickSize: requiredDecimal(
        product.symbol,
        priceFilter,
        "tickSize"
      ),
      quantityStep: requiredDecimal(
        product.symbol,
        lotSizeFilter,
        "stepSize"
      ),
      minimumQuantity: nullablePositive(lotSizeFilter.minQty),
      maximumQuantity: nullablePositive(lotSizeFilter.maxQty),
      minimumNotional: nullablePositive(notionalFilter.minNotional),
      maximumNotional: nullablePositive(notionalFilter.maxNotional),
      observedAtMs: receivedTimestampMs
    }
  });
}

async function parseBoundedJson(
  response: Response,
  label: string,
  maxResponseBytes: number
): Promise<unknown> {
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1) {
    throw new Error(`Invalid Binance maxResponseBytes: ${maxResponseBytes}`);
  }
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    /^\d+$/u.test(declaredLength) &&
    Number(declaredLength) > maxResponseBytes
  ) {
    throw new Error(
      `${label} exceeded ${maxResponseBytes} response bytes`
    );
  }
  if (response.body === null) {
    throw new Error(`${label} returned an empty body`);
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    const chunk = Buffer.from(result.value);
    totalBytes += chunk.byteLength;
    if (totalBytes > maxResponseBytes) {
      await reader.cancel("response_size_limit");
      throw new Error(
        `${label} exceeded ${maxResponseBytes} response bytes`
      );
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks, totalBytes).toString("utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} returned invalid JSON: ${reason}`);
  }
}

export async function fetchBinancePublicExchangeInfo(
  products: readonly BinancePublicProduct[],
  options: BinancePublicFetchOptions = {}
): Promise<BinanceExchangeInfo> {
  assertBinanceProductSet(products);
  const fetchImpl = options.fetchImpl ?? fetch;
  const symbols = encodeURIComponent(JSON.stringify(products));
  const url =
    `${BINANCE_PUBLIC_REST_BASE_URL}/api/v3/exchangeInfo?symbols=${symbols}`;
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
      `Binance public exchangeInfo request failed: HTTP ${response.status}`
    );
  }

  const parsed = binanceExchangeInfoSchema.parse(
    await parseBoundedJson(
      response,
      "Binance public exchangeInfo response",
      options.maxResponseBytes ?? DEFAULT_MAX_REST_RESPONSE_BYTES
    )
  );
  const returned = new Set(parsed.symbols.map((symbol) => symbol.symbol));
  if (
    returned.size !== products.length ||
    !products.every((product) => returned.has(product))
  ) {
    throw new Error(
      "Binance exchangeInfo did not return each requested product exactly once"
    );
  }
  return parsed;
}

export async function fetchBinancePublicDepthSnapshot(
  product: BinancePublicProduct,
  options: BinancePublicFetchOptions = {}
): Promise<BinanceDepthSnapshot> {
  assertBinancePublicProduct(product);
  const fetchImpl = options.fetchImpl ?? fetch;
  const url =
    `${BINANCE_PUBLIC_REST_BASE_URL}/api/v3/depth?symbol=` +
    `${encodeURIComponent(product)}&limit=${BINANCE_DEPTH_SNAPSHOT_LIMIT}`;
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
      `Binance public depth request failed for ${product}: HTTP ${response.status}`
    );
  }
  return binanceDepthSnapshotSchema.parse(
    await parseBoundedJson(
      response,
      `Binance public depth response for ${product}`,
      options.maxResponseBytes ?? DEFAULT_MAX_REST_RESPONSE_BYTES
    )
  );
}
