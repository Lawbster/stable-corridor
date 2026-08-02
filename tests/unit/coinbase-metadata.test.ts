import { describe, expect, it, vi } from "vitest";

import {
  fetchCoinbasePublicProductMetadata,
  normalizeCoinbaseProductMetadata
} from "../../src/venues/coinbase/metadata.js";
import {
  COINBASE_ADVANCED_PUBLIC_REST_BASE_URL,
  createCoinbaseSubscriptionMessages
} from "../../src/venues/coinbase/constants.js";
import {
  coinbaseEurcUsdcProduct,
  coinbaseUsdcEurProduct
} from "../fixtures/coinbase.js";

const context = {
  receivedTimestampMs: Date.UTC(2026, 7, 2, 1, 0, 0),
  ingestSequence: 10,
  collectorRunId: "11111111-1111-4111-8111-111111111111",
  connectionId: "22222222-2222-4222-8222-222222222222"
};

describe("Coinbase public metadata", () => {
  it("normalizes Advanced Trade metadata without floating point", () => {
    const event = normalizeCoinbaseProductMetadata(
      coinbaseEurcUsdcProduct,
      context
    );

    expect(event.payload).toEqual({
      baseAsset: "EURC",
      quoteAsset: "USDC",
      status: "limit_only",
      tickSize: "0.0001",
      quantityStep: "1",
      minimumQuantity: "1",
      maximumQuantity: "8944543.8282647584973166",
      minimumNotional: "2",
      maximumNotional: "10000000",
      observedAtMs: context.receivedTimestampMs
    });
    expect(event.source).toBe("rest");
    expect(event.sourceTimestampMs).toBeNull();
  });

  it("maps normal and disabled products explicitly", () => {
    expect(
      normalizeCoinbaseProductMetadata(coinbaseUsdcEurProduct, context)
        .payload.status
    ).toBe("online");
    expect(
      normalizeCoinbaseProductMetadata(
        { ...coinbaseUsdcEurProduct, trading_disabled: true },
        context
      ).payload.status
    ).toBe("offline");
  });

  it("rejects a non-spot product", () => {
    expect(() =>
      normalizeCoinbaseProductMetadata(
        { ...coinbaseEurcUsdcProduct, product_type: "FUTURE" },
        context
      )
    ).toThrow(/is not spot/u);
  });

  it("uses only the fixed public endpoint and no authentication header", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(coinbaseEurcUsdcProduct), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    ) as unknown as typeof fetch;

    const product = await fetchCoinbasePublicProductMetadata("EURC-USDC", {
      fetchImpl
    });

    expect(product.product_id).toBe("EURC-USDC");
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, request] = vi.mocked(fetchImpl).mock.calls[0]!;
    expect(url).toBe(
      `${COINBASE_ADVANCED_PUBLIC_REST_BASE_URL}/products/EURC-USDC`
    );
    expect(request).toEqual({
      method: "GET",
      headers: {
        accept: "application/json",
        "cache-control": "no-cache"
      }
    });
    expect(
      Object.keys((request as RequestInit).headers as Record<string, string>)
    ).not.toContain("authorization");
  });

  it("fails closed on an HTTP or schema error", async () => {
    const unavailable = vi.fn(
      async () => new Response("unavailable", { status: 503 })
    ) as unknown as typeof fetch;
    await expect(
      fetchCoinbasePublicProductMetadata("EURC-USDC", {
        fetchImpl: unavailable
      })
    ).rejects.toThrow(/HTTP 503/u);

    const malformed = vi.fn(
      async () =>
        new Response(JSON.stringify({ product_id: "EURC-USDC" }), {
          status: 200
        })
    ) as unknown as typeof fetch;
    await expect(
      fetchCoinbasePublicProductMetadata("EURC-USDC", {
        fetchImpl: malformed
      })
    ).rejects.toThrow();
  });
});

describe("Coinbase public subscriptions", () => {
  it("creates one unauthenticated message per required channel", () => {
    const messages = createCoinbaseSubscriptionMessages([
      "EURC-USDC",
      "USDC-EUR"
    ]);

    expect(messages.map((message) => message.channel)).toEqual([
      "level2",
      "market_trades",
      "status",
      "heartbeats"
    ]);
    for (const message of messages) {
      expect(message).not.toHaveProperty("jwt");
      expect(message).toEqual({
        type: "subscribe",
        product_ids: ["EURC-USDC", "USDC-EUR"],
        channel: message.channel
      });
    }
  });
});
