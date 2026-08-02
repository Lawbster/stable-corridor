import { describe, expect, it, vi } from "vitest";

import {
  BINANCE_DEPTH_SNAPSHOT_LIMIT,
  BINANCE_PUBLIC_REST_BASE_URL
} from "../../src/venues/binance/constants.js";
import {
  fetchBinancePublicDepthSnapshot,
  fetchBinancePublicExchangeInfo,
  normalizeBinanceProductMetadata
} from "../../src/venues/binance/metadata.js";
import {
  binanceDepthSnapshot,
  binanceExchangeInfo,
  binanceExchangeInfoEurUsdc
} from "../fixtures/binance.js";

const context = {
  receivedTimestampMs: Date.UTC(2026, 7, 2, 3, 0, 0),
  ingestSequence: 10,
  collectorRunId: "11111111-1111-4111-8111-111111111111",
  connectionId: "22222222-2222-4222-8222-222222222222",
  serverTimeMs: binanceExchangeInfo.serverTime
};

describe("Binance public metadata", () => {
  it("normalizes filters without floating point", () => {
    const event = normalizeBinanceProductMetadata(
      binanceExchangeInfo.symbols[0],
      context
    );

    expect(event).toMatchObject({
      venue: "binance",
      product: "EUR-USDC",
      nativeProduct: "EURUSDC",
      source: "rest",
      sourceTimestampMs: binanceExchangeInfo.serverTime,
      payload: {
        baseAsset: "EUR",
        quoteAsset: "USDC",
        status: "online",
        tickSize: "0.0001",
        quantityStep: "0.1",
        minimumQuantity: "0.1",
        maximumQuantity: "6000000",
        minimumNotional: "5",
        maximumNotional: "9000000"
      }
    });
  });

  it("maps unavailable products and rejects changed contracts", () => {
    expect(
      normalizeBinanceProductMetadata(
        {
          ...binanceExchangeInfo.symbols[0],
          status: "BREAK"
        },
        context
      ).payload.status
    ).toBe("offline");
    expect(() =>
      normalizeBinanceProductMetadata(
        {
          ...binanceExchangeInfo.symbols[0],
          baseAsset: "CHANGED"
        },
        context
      )
    ).toThrow(/asset mapping changed/u);
    expect(() =>
      normalizeBinanceProductMetadata(
        {
          ...binanceExchangeInfo.symbols[0],
          filters: binanceExchangeInfo.symbols[0]!.filters.filter(
            (filter) => filter.filterType !== "LOT_SIZE"
          )
        },
        context
      )
    ).toThrow(/lacks LOT_SIZE/u);
  });

  it("uses only fixed unauthenticated market-data endpoints", async () => {
    const exchangeFetch = vi.fn(async () =>
      new Response(JSON.stringify(binanceExchangeInfoEurUsdc), {
        status: 200
      })
    ) as unknown as typeof fetch;
    const depthFetch = vi.fn(async () =>
      new Response(JSON.stringify(binanceDepthSnapshot), { status: 200 })
    ) as unknown as typeof fetch;

    await expect(
      fetchBinancePublicExchangeInfo(["EURUSDC"], {
        fetchImpl: exchangeFetch
      })
    ).resolves.toMatchObject({ timezone: "UTC" });
    await expect(
      fetchBinancePublicDepthSnapshot("EURUSDC", {
        fetchImpl: depthFetch
      })
    ).resolves.toMatchObject({ lastUpdateId: 190295610 });

    const [exchangeUrl, exchangeRequest] = vi.mocked(exchangeFetch).mock
      .calls[0]!;
    expect(exchangeUrl).toBe(
      `${BINANCE_PUBLIC_REST_BASE_URL}/api/v3/exchangeInfo?` +
        "symbols=%5B%22EURUSDC%22%5D"
    );
    const [depthUrl, depthRequest] = vi.mocked(depthFetch).mock.calls[0]!;
    expect(depthUrl).toBe(
      `${BINANCE_PUBLIC_REST_BASE_URL}/api/v3/depth?` +
        `symbol=EURUSDC&limit=${BINANCE_DEPTH_SNAPSHOT_LIMIT}`
    );
    for (const request of [exchangeRequest, depthRequest]) {
      const headers = (request as RequestInit).headers as Record<
        string,
        string
      >;
      expect(Object.keys(headers)).not.toContain("authorization");
      expect(headers).not.toHaveProperty("x-mbx-apikey");
    }
  });

  it("fails closed on missing products, HTTP errors, and large responses", async () => {
    const missing = vi.fn(async () =>
      new Response(
        JSON.stringify({ ...binanceExchangeInfo, symbols: [] }),
        { status: 200 }
      )
    ) as unknown as typeof fetch;
    await expect(
      fetchBinancePublicExchangeInfo(["EURUSDC"], {
        fetchImpl: missing
      })
    ).rejects.toThrow();

    const unavailable = vi.fn(
      async () => new Response("unavailable", { status: 503 })
    ) as unknown as typeof fetch;
    await expect(
      fetchBinancePublicDepthSnapshot("EURUSDC", {
        fetchImpl: unavailable
      })
    ).rejects.toThrow(/HTTP 503/u);

    const tooLarge = vi.fn(async () =>
      new Response(JSON.stringify(binanceExchangeInfoEurUsdc), {
        status: 200
      })
    ) as unknown as typeof fetch;
    await expect(
      fetchBinancePublicExchangeInfo(["EURUSDC"], {
        fetchImpl: tooLarge,
        maxResponseBytes: 10
      })
    ).rejects.toThrow(/exceeded 10 response bytes/u);
  });
});
