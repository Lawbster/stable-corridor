import { describe, expect, it, vi } from "vitest";

import {
  KRAKEN_PUBLIC_REST_BASE_URL,
  KRAKEN_PUBLIC_PRODUCTS
} from "../../src/venues/kraken/constants.js";
import {
  fetchKrakenPublicAssetPairs,
  normalizeKrakenProductMetadata
} from "../../src/venues/kraken/metadata.js";
import { krakenAssetPairs } from "../fixtures/kraken.js";

const context = {
  receivedTimestampMs: Date.UTC(2026, 7, 2, 14, 20, 0),
  ingestSequence: 10,
  collectorRunId: "11111111-1111-4111-8111-111111111111",
  connectionId: "22222222-2222-4222-8222-222222222222"
};

describe("Kraken public metadata", () => {
  it("normalizes exact pair rules and legacy asset identifiers", () => {
    const event = normalizeKrakenProductMetadata(
      "EURC/USDC",
      krakenAssetPairs.result.EURCUSDC,
      context
    );
    expect(event).toMatchObject({
      venue: "kraken",
      product: "EURC-USDC",
      nativeProduct: "EURC/USDC",
      source: "rest",
      sourceTimestampMs: null,
      payload: {
        baseAsset: "EURC",
        quoteAsset: "USDC",
        status: "online",
        tickSize: "0.00001",
        quantityStep: "0.00000001",
        minimumQuantity: "4",
        minimumNotional: "0.5"
      }
    });
    expect(
      normalizeKrakenProductMetadata(
        "USDC/EUR",
        krakenAssetPairs.result.USDCEUR,
        context
      )
    ).toMatchObject({
      product: "USDC-EUR",
      payload: {
        quoteAsset: "EUR",
        minimumQuantity: "5",
        minimumNotional: "0.45"
      }
    });
  });

  it("maps restricted status and rejects changed assets", () => {
    expect(
      normalizeKrakenProductMetadata(
        "EURC/USDC",
        {
          ...krakenAssetPairs.result.EURCUSDC!,
          status: "maintenance"
        },
        context
      ).payload.status
    ).toBe("offline");
    expect(() =>
      normalizeKrakenProductMetadata(
        "EURC/USDC",
        {
          ...krakenAssetPairs.result.EURCUSDC!,
          quote: "CHANGED"
        },
        context
      )
    ).toThrow(/asset mapping changed/u);
  });

  it("uses only the fixed unauthenticated AssetPairs endpoint", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(krakenAssetPairs), { status: 200 })
    ) as unknown as typeof fetch;
    await expect(
      fetchKrakenPublicAssetPairs(KRAKEN_PUBLIC_PRODUCTS, {
        fetchImpl
      })
    ).resolves.toEqual(krakenAssetPairs);
    const [url, request] = vi.mocked(fetchImpl).mock.calls[0]!;
    expect(url).toBe(
      `${KRAKEN_PUBLIC_REST_BASE_URL}/0/public/AssetPairs?pair=` +
        "EURCUSDC%2CEURCEUR%2CEURCUSD%2CUSDCEUR%2CUSDCUSD"
    );
    const headers = (request as RequestInit).headers as Record<
      string,
      string
    >;
    expect(Object.keys(headers).map((key) => key.toLowerCase())).not.toContain(
      "authorization"
    );
    expect(
      Object.keys(headers).some((key) => /api.?key|signature/iu.test(key))
    ).toBe(false);
  });

  it("fails closed on API, product, HTTP, and response-size errors", async () => {
    const apiError = vi.fn(async () =>
      new Response(
        JSON.stringify({ ...krakenAssetPairs, error: ["EGeneral:Busy"] }),
        { status: 200 }
      )
    ) as unknown as typeof fetch;
    await expect(
      fetchKrakenPublicAssetPairs(["EURC/USDC"], {
        fetchImpl: apiError
      })
    ).rejects.toThrow(/EGeneral:Busy/u);

    const missing = vi.fn(async () =>
      new Response(JSON.stringify({ error: [], result: {} }), {
        status: 200
      })
    ) as unknown as typeof fetch;
    await expect(
      fetchKrakenPublicAssetPairs(["EURC/USDC"], {
        fetchImpl: missing
      })
    ).rejects.toThrow(/omitted EURC\/USDC/u);

    const unavailable = vi.fn(
      async () => new Response("unavailable", { status: 503 })
    ) as unknown as typeof fetch;
    await expect(
      fetchKrakenPublicAssetPairs(["EURC/USDC"], {
        fetchImpl: unavailable
      })
    ).rejects.toThrow(/HTTP 503/u);

    const tooLarge = vi.fn(async () =>
      new Response(JSON.stringify(krakenAssetPairs), { status: 200 })
    ) as unknown as typeof fetch;
    await expect(
      fetchKrakenPublicAssetPairs(["EURC/USDC"], {
        fetchImpl: tooLarge,
        maxResponseBytes: 10
      })
    ).rejects.toThrow(/exceeded 10 response bytes/u);
  });
});
