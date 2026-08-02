import { describe, expect, it, vi } from "vitest";

import { BYBIT_PUBLIC_REST_BASE_URL } from "../../src/venues/bybit/constants.js";
import {
  fetchBybitPublicInstrument,
  fetchBybitPublicInstruments,
  normalizeBybitProductMetadata
} from "../../src/venues/bybit/metadata.js";
import {
  bybitUsdcEurInstrument,
  bybitUsdcUsdtInstrument,
  bybitUsdtEurInstrument
} from "../fixtures/bybit.js";

const context = {
  receivedTimestampMs: Date.UTC(2026, 7, 2, 5, 0, 0),
  ingestSequence: 10,
  collectorRunId: "11111111-1111-4111-8111-111111111111",
  connectionId: "22222222-2222-4222-8222-222222222222",
  serverTimeMs: bybitUsdcUsdtInstrument.time
};

describe("Bybit public metadata", () => {
  it("normalizes exact public instrument limits without floating point", () => {
    const eur = normalizeBybitProductMetadata(
      bybitUsdcEurInstrument.result.list[0],
      context
    );
    expect(eur).toMatchObject({
      venue: "bybit",
      product: "USDC-EUR",
      nativeProduct: "USDCEUR",
      source: "rest",
      payload: {
        baseAsset: "USDC",
        quoteAsset: "EUR",
        status: "online",
        tickSize: "0.0001",
        quantityStep: "0.01",
        minimumQuantity: "0.01",
        maximumQuantity: "6837000",
        minimumNotional: "1",
        maximumNotional: "180000"
      }
    });

    const stable = normalizeBybitProductMetadata(
      bybitUsdcUsdtInstrument.result.list[0],
      context
    );
    expect(stable.payload.minimumNotional).toBe("5");
  });

  it("maps unavailable products and rejects changed asset contracts", () => {
    expect(
      normalizeBybitProductMetadata(
        {
          ...bybitUsdtEurInstrument.result.list[0],
          status: "Closed"
        },
        context
      ).payload.status
    ).toBe("offline");
    expect(() =>
      normalizeBybitProductMetadata(
        {
          ...bybitUsdtEurInstrument.result.list[0],
          quoteCoin: "CHANGED"
        },
        context
      )
    ).toThrow(/asset mapping changed/u);
  });

  it("uses only the fixed unauthenticated market-data endpoint", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(bybitUsdcEurInstrument), {
        status: 200
      })
    ) as unknown as typeof fetch;

    await expect(
      fetchBybitPublicInstrument("USDCEUR", { fetchImpl })
    ).resolves.toEqual(bybitUsdcEurInstrument);

    const [url, request] = vi.mocked(fetchImpl).mock.calls[0]!;
    expect(url).toBe(
      `${BYBIT_PUBLIC_REST_BASE_URL}/v5/market/instruments-info?` +
        "category=spot&symbol=USDCEUR"
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

  it("fetches the configured set and fails closed on response errors", async () => {
    const responses = new Map([
      ["USDTEUR", bybitUsdtEurInstrument],
      ["USDCEUR", bybitUsdcEurInstrument],
      ["USDCUSDT", bybitUsdcUsdtInstrument]
    ]);
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const symbol = new URL(String(input)).searchParams.get("symbol")!;
      return new Response(JSON.stringify(responses.get(symbol)), {
        status: 200
      });
    }) as unknown as typeof fetch;
    await expect(
      fetchBybitPublicInstruments(
        ["USDTEUR", "USDCEUR", "USDCUSDT"],
        { fetchImpl }
      )
    ).resolves.toHaveLength(3);

    const apiError = vi.fn(async () =>
      new Response(
        JSON.stringify({
          retCode: 10001,
          retMsg: "bad request",
          result: {},
          time: bybitUsdcUsdtInstrument.time
        }),
        { status: 200 }
      )
    ) as unknown as typeof fetch;
    await expect(
      fetchBybitPublicInstrument("USDCUSDT", {
        fetchImpl: apiError
      })
    ).rejects.toThrow(/10001 bad request/u);

    const wrongProduct = vi.fn(async () =>
      new Response(JSON.stringify(bybitUsdcEurInstrument), {
        status: 200
      })
    ) as unknown as typeof fetch;
    await expect(
      fetchBybitPublicInstrument("USDCUSDT", {
        fetchImpl: wrongProduct
      })
    ).rejects.toThrow(/did not return requested product/u);

    const unavailable = vi.fn(
      async () => new Response("unavailable", { status: 503 })
    ) as unknown as typeof fetch;
    await expect(
      fetchBybitPublicInstrument("USDCUSDT", {
        fetchImpl: unavailable
      })
    ).rejects.toThrow(/HTTP 503/u);

    const tooLarge = vi.fn(async () =>
      new Response(JSON.stringify(bybitUsdcUsdtInstrument), {
        status: 200
      })
    ) as unknown as typeof fetch;
    await expect(
      fetchBybitPublicInstrument("USDCUSDT", {
        fetchImpl: tooLarge,
        maxResponseBytes: 10
      })
    ).rejects.toThrow(/exceeded 10 response bytes/u);
  });
});
