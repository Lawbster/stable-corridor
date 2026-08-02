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
  assertBybitPublicProduct,
  bybitCanonicalProduct,
  BYBIT_PUBLIC_REST_BASE_URL,
  type BybitPublicProduct
} from "./constants.js";
import {
  bybitInstrumentResponseSchema,
  bybitResponseBaseSchema,
  bybitSpotInstrumentSchema,
  type BybitInstrumentResponse,
  type BybitSpotInstrument
} from "./schemas.js";

export type BybitInstrumentEvent = Extract<
  NormalizedEvent,
  { readonly eventType: "instrument" }
>;

export interface BybitMetadataContext {
  readonly receivedTimestampMs: number;
  readonly ingestSequence: number;
  readonly collectorRunId: string;
  readonly connectionId: string;
  readonly serverTimeMs: number;
}

export interface BybitPublicFetchOptions {
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly maxResponseBytes?: number;
}

const DEFAULT_MAX_REST_RESPONSE_BYTES = 1024 * 1024;

function mapStatus(
  product: BybitSpotInstrument
): BybitInstrumentEvent["payload"]["status"] {
  if (product.status === "Trading") {
    return "online";
  }
  if (
    product.status === "Closed" ||
    product.status === "Settled" ||
    product.status === "Delisted"
  ) {
    return "offline";
  }
  return "unknown";
}

function nullablePositive(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const normalized = normalizeDecimalString(value);
  return normalized === "0" ? null : normalized;
}

export function normalizeBybitProductMetadata(
  input: unknown,
  context: BybitMetadataContext
): BybitInstrumentEvent {
  const product = bybitSpotInstrumentSchema.parse(input);
  const receivedTimestampMs = utcEpochMillisecondsSchema.parse(
    context.receivedTimestampMs
  );
  const sourceTimestampMs = utcEpochMillisecondsSchema.parse(
    context.serverTimeMs
  );
  const collectorRunId = collectorRunIdSchema.parse(context.collectorRunId);
  const connectionId = connectionIdSchema.parse(context.connectionId);
  const expectedAssets: Record<
    BybitPublicProduct,
    readonly [string, string]
  > = {
    USDTEUR: ["USDT", "EUR"],
    USDCEUR: ["USDC", "EUR"],
    USDCUSDT: ["USDC", "USDT"]
  };
  const [expectedBase, expectedQuote] = expectedAssets[product.symbol];
  if (
    product.baseCoin !== expectedBase ||
    product.quoteCoin !== expectedQuote
  ) {
    throw new Error(
      `Bybit product ${product.symbol} asset mapping changed: ` +
        `${product.baseCoin}/${product.quoteCoin}`
    );
  }

  return instrumentEventSchema.parse({
    schemaVersion: 1,
    eventType: "instrument",
    venue: "bybit",
    product: bybitCanonicalProduct(product.symbol),
    nativeProduct: product.symbol,
    sourceTimestampMs,
    receivedTimestampMs,
    ingestSequence: context.ingestSequence,
    collectorRunId,
    connectionId,
    venueSequence: null,
    source: "rest",
    payload: {
      baseAsset: product.baseCoin,
      quoteAsset: product.quoteCoin,
      status: mapStatus(product),
      tickSize: normalizeDecimalString(product.priceFilter.tickSize),
      quantityStep: normalizeDecimalString(
        product.lotSizeFilter.basePrecision
      ),
      minimumQuantity: nullablePositive(
        product.lotSizeFilter.minOrderQty
      ),
      maximumQuantity: nullablePositive(
        product.lotSizeFilter.maxLimitOrderQty
      ),
      minimumNotional: nullablePositive(
        product.lotSizeFilter.minOrderAmt
      ),
      maximumNotional: nullablePositive(
        product.lotSizeFilter.maxOrderAmt
      ),
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
    throw new Error(`Invalid Bybit maxResponseBytes: ${maxResponseBytes}`);
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

export async function fetchBybitPublicInstrument(
  product: BybitPublicProduct,
  options: BybitPublicFetchOptions = {}
): Promise<BybitInstrumentResponse> {
  assertBybitPublicProduct(product);
  const fetchImpl = options.fetchImpl ?? fetch;
  const url =
    `${BYBIT_PUBLIC_REST_BASE_URL}/v5/market/instruments-info?` +
    `category=spot&symbol=${encodeURIComponent(product)}`;
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
      `Bybit public instrument request failed for ${product}: ` +
        `HTTP ${response.status}`
    );
  }

  const raw = await parseBoundedJson(
    response,
    `Bybit public instrument response for ${product}`,
    options.maxResponseBytes ?? DEFAULT_MAX_REST_RESPONSE_BYTES
  );
  const base = bybitResponseBaseSchema.parse(raw);
  if (base.retCode !== 0) {
    throw new Error(
      `Bybit public instrument request failed for ${product}: ` +
        `${base.retCode} ${base.retMsg}`
    );
  }
  const parsed = bybitInstrumentResponseSchema.parse(raw);
  if (parsed.result.list[0]?.symbol !== product) {
    throw new Error(
      `Bybit instrument response did not return requested product ${product}`
    );
  }
  return parsed;
}

export async function fetchBybitPublicInstruments(
  products: readonly BybitPublicProduct[],
  options: BybitPublicFetchOptions = {}
): Promise<readonly BybitInstrumentResponse[]> {
  if (products.length === 0) {
    throw new Error("At least one Bybit product is required");
  }
  if (new Set(products).size !== products.length) {
    throw new Error("Bybit products must be unique");
  }
  return Promise.all(
    products.map((product) =>
      fetchBybitPublicInstrument(product, options)
    )
  );
}
