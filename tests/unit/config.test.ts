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
    expect(config.binance.staleAfterMs).toBe(30_000);
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
      }
    });

    expect(result.success).toBe(false);
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
});
