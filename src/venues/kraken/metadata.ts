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
  assertKrakenProductSet,
  krakenCanonicalProduct,
  KRAKEN_PUBLIC_REST_BASE_URL,
  KRAKEN_REST_PRODUCTS,
  type KrakenPublicProduct
} from "./constants.js";
import {
  krakenAssetPairsResponseSchema,
  type KrakenAssetPair,
  type KrakenAssetPairsResponse
} from "./schemas.js";

export type KrakenInstrumentEvent = Extract<
  NormalizedEvent,
  { readonly eventType: "instrument" }
>;

export interface KrakenMetadataContext {
  readonly receivedTimestampMs: number;
  readonly ingestSequence: number;
  readonly collectorRunId: string;
  readonly connectionId: string;
}

export interface KrakenPublicFetchOptions {
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly maxResponseBytes?: number;
}

const DEFAULT_MAX_REST_RESPONSE_BYTES = 1024 * 1024;

const expectedAssets: Record<
  KrakenPublicProduct,
  {
    readonly restBase: string;
    readonly restQuote: string;
    readonly base: string;
    readonly quote: string;
  }
> = {
  "EURC/USDC": {
    restBase: "EURC",
    restQuote: "USDC",
    base: "EURC",
    quote: "USDC"
  },
  "EURC/EUR": {
    restBase: "EURC",
    restQuote: "ZEUR",
    base: "EURC",
    quote: "EUR"
  },
  "EURC/USD": {
    restBase: "EURC",
    restQuote: "ZUSD",
    base: "EURC",
    quote: "USD"
  },
  "USDC/EUR": {
    restBase: "USDC",
    restQuote: "ZEUR",
    base: "USDC",
    quote: "EUR"
  },
  "USDC/USD": {
    restBase: "USDC",
    restQuote: "ZUSD",
    base: "USDC",
    quote: "USD"
  }
};

function mapStatus(
  status: string
): KrakenInstrumentEvent["payload"]["status"] {
  switch (status) {
    case "online":
      return "online";
    case "limit_only":
      return "limit_only";
    case "post_only":
      return "post_only";
    case "cancel_only":
      return "cancel_only";
    case "delisted":
    case "maintenance":
      return "offline";
    default:
      return "unknown";
  }
}

function decimalStep(decimals: number): string {
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 32) {
    throw new Error(`Unsupported Kraken quantity precision: ${decimals}`);
  }
  return decimals === 0 ? "1" : `0.${"0".repeat(decimals - 1)}1`;
}

export function normalizeKrakenProductMetadata(
  product: KrakenPublicProduct,
  input: unknown,
  context: KrakenMetadataContext
): KrakenInstrumentEvent {
  const pair = krakenAssetPairsResponseSchema.shape.result.valueType.parse(
    input
  );
  if (pair.wsname !== product) {
    throw new Error(
      `Kraken metadata returned ${pair.wsname} for ${product}`
    );
  }
  const assets = expectedAssets[product];
  if (pair.base !== assets.restBase || pair.quote !== assets.restQuote) {
    throw new Error(
      `Kraken product ${product} asset mapping changed: ` +
        `${pair.base}/${pair.quote}`
    );
  }

  const receivedTimestampMs = utcEpochMillisecondsSchema.parse(
    context.receivedTimestampMs
  );
  return instrumentEventSchema.parse({
    schemaVersion: 1,
    eventType: "instrument",
    venue: "kraken",
    product: krakenCanonicalProduct(product),
    nativeProduct: product,
    sourceTimestampMs: null,
    receivedTimestampMs,
    ingestSequence: context.ingestSequence,
    collectorRunId: collectorRunIdSchema.parse(context.collectorRunId),
    connectionId: connectionIdSchema.parse(context.connectionId),
    venueSequence: null,
    source: "rest",
    payload: {
      baseAsset: assets.base,
      quoteAsset: assets.quote,
      status: mapStatus(pair.status),
      tickSize: normalizeDecimalString(pair.tick_size),
      quantityStep: decimalStep(pair.lot_decimals),
      minimumQuantity: normalizeDecimalString(pair.ordermin),
      maximumQuantity: null,
      minimumNotional: normalizeDecimalString(pair.costmin),
      maximumNotional: null,
      observedAtMs: receivedTimestampMs
    }
  });
}

function selectedPair(
  response: KrakenAssetPairsResponse,
  product: KrakenPublicProduct
): KrakenAssetPair {
  const restName = KRAKEN_REST_PRODUCTS[product];
  const pair = response.result[restName];
  if (pair === undefined) {
    throw new Error(`Kraken metadata omitted ${product} (${restName})`);
  }
  if (pair.wsname !== product) {
    throw new Error(
      `Kraken metadata returned ${pair.wsname} for ${product}`
    );
  }
  return pair;
}

async function parseBoundedJson(
  response: Response,
  maxResponseBytes: number
): Promise<unknown> {
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1) {
    throw new Error(
      `Invalid Kraken maxResponseBytes: ${maxResponseBytes}`
    );
  }
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    /^\d+$/u.test(declaredLength) &&
    Number(declaredLength) > maxResponseBytes
  ) {
    throw new Error(
      `Kraken AssetPairs exceeded ${maxResponseBytes} response bytes`
    );
  }
  if (response.body === null) {
    throw new Error("Kraken AssetPairs returned an empty body");
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
        `Kraken AssetPairs exceeded ${maxResponseBytes} response bytes`
      );
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks, totalBytes).toString("utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Kraken AssetPairs returned invalid JSON: ${reason}`);
  }
}

export async function fetchKrakenPublicAssetPairs(
  products: readonly KrakenPublicProduct[],
  options: KrakenPublicFetchOptions = {}
): Promise<KrakenAssetPairsResponse> {
  assertKrakenProductSet(products);
  const requested = products
    .map((product) => KRAKEN_REST_PRODUCTS[product])
    .join(",");
  const url =
    `${KRAKEN_PUBLIC_REST_BASE_URL}/0/public/AssetPairs?pair=` +
    encodeURIComponent(requested);
  const fetchImpl = options.fetchImpl ?? fetch;
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
      `Kraken public AssetPairs request failed: HTTP ${response.status}`
    );
  }
  const parsed = krakenAssetPairsResponseSchema.parse(
    await parseBoundedJson(
      response,
      options.maxResponseBytes ?? DEFAULT_MAX_REST_RESPONSE_BYTES
    )
  );
  if (parsed.error.length > 0) {
    throw new Error(
      `Kraken public AssetPairs request failed: ${parsed.error.join("; ")}`
    );
  }
  for (const product of products) {
    selectedPair(parsed, product);
  }
  return parsed;
}

export function krakenPairFromResponse(
  response: KrakenAssetPairsResponse,
  product: KrakenPublicProduct
): KrakenAssetPair {
  return selectedPair(response, product);
}
