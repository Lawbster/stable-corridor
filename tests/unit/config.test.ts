import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  collectorConfigSchema,
  parseCollectorConfig
} from "../../src/collector/config.js";

describe("collector configuration", () => {
  it("validates the reviewed public-only example", async () => {
    const contents = await readFile(
      resolve("config/collector.example.json"),
      "utf8"
    );
    const config = parseCollectorConfig(JSON.parse(contents));

    expect(config.processName).toBe("stable-corridor-collector");
    expect(config.book.depth).toBe(20);
    expect(config.storage.maxDataBytes).toBe(10 * 1024 * 1024 * 1024);
    expect(config.storage.minFreeBytes).toBe(40 * 1024 * 1024 * 1024);
    expect(config.runtime.healthIntervalMs).toBe(30_000);
    expect(config.runtime.restRequestTimeoutMs).toBe(10_000);
    expect(config.coinbase?.products).toEqual(["EURC-USDC"]);
    expect(config.coinbase?.staleAfterMs).toBe(5_000);
    expect(config.binance).toBeUndefined();
    expect(config.bybit).toBeUndefined();
    expect(config.kraken).toBeUndefined();
    expect(config.jupiter?.product).toBe("EURC-USDC");
    expect(config.jupiter?.inputAmounts).toEqual(["1000", "10000"]);
    expect(config.jupiter?.minimumRequestIntervalMs).toBe(2_100);
    expect(config.jupiter?.anomalyProbe).toEqual({
      coinbaseFeeBps: 0.1,
      modeledNetworkFeeUsdc: 0.01,
      executionBufferBps: 2,
      decisionThresholdBps: 3,
      followUpCount: 3
    });
  });

  it("keeps Jupiter opt-in and enforces the public rate floor", async () => {
    const contents = await readFile(
      resolve("config/collector.example.json"),
      "utf8"
    );
    const example = JSON.parse(contents) as Record<string, unknown>;
    const { jupiter: _jupiter, ...withoutJupiter } = example;
    expect(parseCollectorConfig(withoutJupiter).jupiter).toBeUndefined();
    expect(
      collectorConfigSchema.safeParse({
        ...example,
        jupiter: {
          ...(example.jupiter as Record<string, unknown>),
          minimumRequestIntervalMs: 1_999
        }
      }).success
    ).toBe(false);
  });

  it("rejects relative runtime paths", () => {
    const result = collectorConfigSchema.safeParse({
      schemaVersion: 1,
      processName: "stable-corridor-collector",
      dataRoot: "./data",
      healthFile: "./state/health.json",
      journal: {
        maxPartBytes: 1024,
        syncEveryAppend: true
      },
      storage: {
        maxDataBytes: 2048,
        minFreeBytes: 1024
      },
      runtime: {
        healthIntervalMs: 30_000,
        staleCheckIntervalMs: 5_000,
        reconnectDelayMs: 5_000,
        restRequestTimeoutMs: 10_000
      },
      book: {
        depth: 20,
        checkpointIntervalMs: 60_000
      },
      coinbase: {
        products: ["EURC-USDC", "USDC-EUR"],
        staleAfterMs: 5_000,
        maxTrackedLevelsPerSide: 10_000,
        maxFrameBytes: 8 * 1024 * 1024
      },
      binance: {
        products: ["EURUSDC", "EURIUSDC", "USDCUSD"],
        staleAfterMs: 30_000,
        maxTrackedLevelsPerSide: 10_000,
        maxBufferedDepthEvents: 10_000,
        maxFrameBytes: 1024 * 1024
      },
      bybit: {
        products: ["USDTEUR", "USDCEUR", "USDCUSDT"],
        staleAfterMs: 30_000,
        maxTrackedLevelsPerSide: 10_000,
        maxRecentTradeIds: 10_000,
        maxFrameBytes: 1024 * 1024,
        pingIntervalMs: 20_000
      },
      kraken: {
        products: [
          "EURC/USDC",
          "EURC/EUR",
          "EURC/USD",
          "USDC/EUR",
          "USDC/USD"
        ],
        depth: 25,
        staleAfterMs: 60_000,
        maxRecentTradeIds: 10_000,
        maxFrameBytes: 1024 * 1024
      }
    });

    expect(result.success).toBe(false);
  });

  it("rejects runtime paths that overlap the isolated HYPE project", async () => {
    const contents = await readFile(
      resolve("config/collector.example.json"),
      "utf8"
    );
    const example = JSON.parse(contents) as Record<string, unknown>;

    expect(
      collectorConfigSchema.safeParse({
        ...example,
        dataRoot: "/opt/bybit-rev/stable-corridor-data"
      }).success
    ).toBe(false);
    expect(
      collectorConfigSchema.safeParse({
        ...example,
        healthFile:
          "C:\\projects\\reverse-copy\\state\\collector-health.json"
      }).success
    ).toBe(false);
  });

  it("accepts reviewed non-empty venue product subsets", () => {
    const example = {
      schemaVersion: 1,
      processName: "stable-corridor-collector",
      dataRoot: "/var/lib/stable-corridor/data",
      healthFile: "/var/lib/stable-corridor/state/health.json",
      journal: {
        maxPartBytes: 1024,
        syncEveryAppend: true
      },
      storage: {
        maxDataBytes: 2048,
        minFreeBytes: 1024
      },
      runtime: {
        healthIntervalMs: 30_000,
        staleCheckIntervalMs: 5_000,
        reconnectDelayMs: 5_000,
        restRequestTimeoutMs: 10_000
      },
      book: {
        depth: 20,
        checkpointIntervalMs: 60_000
      },
      coinbase: {
        products: ["EURC-USDC"],
        staleAfterMs: 5_000,
        maxTrackedLevelsPerSide: 10_000,
        maxFrameBytes: 8 * 1024 * 1024
      },
      binance: {
        products: ["EURUSDC", "EURIUSDC", "USDCUSD"],
        staleAfterMs: 30_000,
        maxTrackedLevelsPerSide: 10_000,
        maxBufferedDepthEvents: 10_000,
        maxFrameBytes: 1024 * 1024
      },
      bybit: {
        products: ["USDTEUR", "USDCEUR", "USDCUSDT"],
        staleAfterMs: 30_000,
        maxTrackedLevelsPerSide: 10_000,
        maxRecentTradeIds: 10_000,
        maxFrameBytes: 1024 * 1024,
        pingIntervalMs: 20_000
      },
      kraken: {
        products: [
          "EURC/USDC",
          "EURC/EUR",
          "EURC/USD",
          "USDC/EUR",
          "USDC/USD"
        ],
        depth: 25,
        staleAfterMs: 60_000,
        maxRecentTradeIds: 10_000,
        maxFrameBytes: 1024 * 1024
      }
    };

    expect(collectorConfigSchema.safeParse(example).success).toBe(true);
  });

  it("accepts optional reference venues with product subsets", async () => {
    const contents = await readFile(
      resolve("config/collector.example.json"),
      "utf8"
    );
    const example = JSON.parse(contents) as Record<string, unknown>;
    example.binance = {
      products: ["EURUSDC"],
      staleAfterMs: 30_000,
      maxTrackedLevelsPerSide: 10_000,
      maxBufferedDepthEvents: 10_000,
      maxFrameBytes: 1024 * 1024
    };

    example.bybit = {
      products: ["USDTEUR"],
      staleAfterMs: 30_000,
      maxTrackedLevelsPerSide: 10_000,
      maxRecentTradeIds: 10_000,
      maxFrameBytes: 1024 * 1024,
      pingIntervalMs: 20_000
    };

    example.kraken = {
      products: ["EURC/USDC"],
      depth: 25,
      staleAfterMs: 60_000,
      maxRecentTradeIds: 10_000,
      maxFrameBytes: 1024 * 1024
    };
    expect(collectorConfigSchema.safeParse(example).success).toBe(true);
  });

  it("rejects empty or duplicate product subsets", async () => {
    const contents = await readFile(
      resolve("config/collector.example.json"),
      "utf8"
    );
    const example = JSON.parse(contents) as Record<string, unknown>;
    const coinbase = example.coinbase as Record<string, unknown>;
    expect(
      collectorConfigSchema.safeParse({
        ...example,
        coinbase: { ...coinbase, products: [] }
      }).success
    ).toBe(false);
    expect(
      collectorConfigSchema.safeParse({
        ...example,
        coinbase: {
          ...coinbase,
          products: ["EURC-USDC", "EURC-USDC"]
        }
      }).success
    ).toBe(false);
  });

  it("requires Coinbase EURC-USDC for the anomaly probe", async () => {
    const contents = await readFile(
      resolve("config/collector.example.json"),
      "utf8"
    );
    const example = JSON.parse(contents) as Record<string, unknown>;
    const coinbase = example.coinbase as Record<string, unknown>;
    expect(
      collectorConfigSchema.safeParse({
        ...example,
        coinbase: { ...coinbase, products: ["USDC-EUR"] }
      }).success
    ).toBe(false);
  });
});
