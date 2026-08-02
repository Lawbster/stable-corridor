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
    expect(config.coinbase.products).toEqual([
      "EURC-USDC",
      "USDC-EUR"
    ]);
    expect(config.coinbase.staleAfterMs).toBe(5_000);
    expect(config.binance.products).toEqual([
      "EURUSDC",
      "EURIUSDC",
      "USDCUSD"
    ]);
    expect(config.binance.staleAfterMs).toBe(120_000);
    expect(config.bybit.products).toEqual([
      "USDTEUR",
      "USDCEUR",
      "USDCUSDT"
    ]);
    expect(config.bybit.staleAfterMs).toBe(30_000);
    expect(config.bybit.pingIntervalMs).toBe(20_000);
    expect(config.kraken.products).toEqual([
      "EURC/USDC",
      "EURC/EUR",
      "EURC/USD",
      "USDC/EUR",
      "USDC/USD"
    ]);
    expect(config.kraken.depth).toBe(25);
    expect(config.kraken.staleAfterMs).toBe(60_000);
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

  it("rejects an incomplete Coinbase product universe", () => {
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

    expect(collectorConfigSchema.safeParse(example).success).toBe(false);
  });

  it("rejects an incomplete Binance product universe", async () => {
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

    expect(collectorConfigSchema.safeParse(example).success).toBe(false);
  });

  it("rejects an incomplete Bybit product universe", async () => {
    const contents = await readFile(
      resolve("config/collector.example.json"),
      "utf8"
    );
    const example = JSON.parse(contents) as Record<string, unknown>;
    example.bybit = {
      products: ["USDTEUR"],
      staleAfterMs: 30_000,
      maxTrackedLevelsPerSide: 10_000,
      maxRecentTradeIds: 10_000,
      maxFrameBytes: 1024 * 1024,
      pingIntervalMs: 20_000
    };

    expect(collectorConfigSchema.safeParse(example).success).toBe(false);
  });

  it("rejects an incomplete Kraken product universe", async () => {
    const contents = await readFile(
      resolve("config/collector.example.json"),
      "utf8"
    );
    const example = JSON.parse(contents) as Record<string, unknown>;
    example.kraken = {
      products: ["EURC/USDC"],
      depth: 25,
      staleAfterMs: 60_000,
      maxRecentTradeIds: 10_000,
      maxFrameBytes: 1024 * 1024
    };
    expect(collectorConfigSchema.safeParse(example).success).toBe(false);
  });
});
