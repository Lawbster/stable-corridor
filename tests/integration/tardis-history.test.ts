import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

import { afterEach, describe, expect, it } from "vitest";

import {
  firstOfMonthDates,
  freeTardisRoutes,
  importFreeTardisHistory,
  normalizeTardisDecimal,
  tardisCollectorRunId,
  type TardisDatasetRoute
} from "../../src/historical/tardis.js";
import {
  discoverClosedJournalParts,
  readMergedJournalParts
} from "../../src/replay/journal-reader.js";
import {
  createTestDirectory,
  removeTestDirectory
} from "../fixtures/temp-directory.js";

const testDirectories: string[] = [];
const date = "2024-01-01";
const midnightMs = Date.UTC(2024, 0, 1);

afterEach(async () => {
  await Promise.all(testDirectories.splice(0).map(removeTestDirectory));
});

function micros(milliseconds: number): string {
  return (BigInt(milliseconds) * 1_000n).toString();
}

function bookCsv(
  route: TardisDatasetRoute,
  receivedTimestampMs: number,
  bid: string,
  ask: string
): string {
  const header = [
    "exchange",
    "symbol",
    "timestamp",
    "local_timestamp",
    ...Array.from({ length: 5 }, (_, index) => [
      `asks[${index}].price`,
      `asks[${index}].amount`,
      `bids[${index}].price`,
      `bids[${index}].amount`
    ]).flat()
  ].join(",");
  const askValue = Number(ask);
  const bidValue = Number(bid);
  const levels = Array.from({ length: 5 }, (_, index) => [
    (askValue + index * 0.0001).toFixed(5),
    String(100 + index),
    (bidValue - index * 0.0001).toFixed(5),
    String(200 + index)
  ]).flat();
  const row = [
    route.exchange,
    route.nativeSymbol ?? route.symbol,
    micros(receivedTimestampMs - 5),
    micros(receivedTimestampMs),
    ...levels
  ].join(",");
  return `${header}\n${row}\n`;
}

function tradeCsv(
  route: TardisDatasetRoute,
  receivedTimestampMs: number
): string {
  return (
    "exchange,symbol,timestamp,local_timestamp,id,side,price,amount\n" +
    [
      route.exchange,
      route.nativeSymbol ?? route.symbol,
      micros(receivedTimestampMs - 5),
      micros(receivedTimestampMs),
      "trade-1",
      "sell",
      "1.1498",
      "100"
    ].join(",") +
    "\n"
  );
}

function bodyForRoute(route: TardisDatasetRoute): Buffer {
  if (route.dataType === "trades") {
    return gzipSync(
      tradeCsv(route, midnightMs + 1_000)
    );
  }
  const reference = route.venue !== "coinbase";
  const inverted = route.product === "USDC-EUR";
  return gzipSync(
    bookCsv(
      route,
      midnightMs + (reference ? 100 : 500),
      inverted ? "0.86948" : "1.1498",
      inverted ? "0.86965" : "1.1502"
    )
  );
}

function mockFetch(): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const route = freeTardisRoutes.find(
      (candidate) =>
        url.includes(`/${candidate.exchange}/`) &&
        url.includes(`/${candidate.dataType}/`) &&
        url.endsWith(`/${candidate.symbol}.csv.gz`)
    );
    if (route === undefined) {
      return new Response("missing", { status: 404 });
    }
    const body = bodyForRoute(route);
    const md5 = createHash("md5").update(body).digest("hex");
    return new Response(body, {
      status: 200,
      headers: {
        "content-length": String(body.byteLength),
        "x-dataset-size": String(body.byteLength),
        "x-md5": `"${md5}"`
      }
    });
  }) as typeof fetch;
}

describe("free Tardis historical import", () => {
  it("generates only first-of-month dates over an inclusive range", () => {
    expect(firstOfMonthDates("2024-11", "2025-02")).toEqual([
      "2024-11-01",
      "2024-12-01",
      "2025-01-01",
      "2025-02-01"
    ]);
    expect(() => firstOfMonthDates("2025-02", "2025-01")).toThrow(
      "Invalid month range"
    );
    expect(normalizeTardisDecimal("2.8e-7")).toBe("0.00000028");
    expect(normalizeTardisDecimal("-1.20E+3")).toBe("-1200");
  });

  it("downloads, normalizes, verifies, and reuses gzip-only journals", async () => {
    const root = await createTestDirectory();
    testDirectories.push(root);
    const cacheRoot = `${root}/cache`;
    const dataRoot = `${root}/data`;
    const first = await importFreeTardisHistory({
      cacheRoot,
      dataRoot,
      dates: [date],
      fetchImplementation: mockFetch(),
      now: () => midnightMs + 86_400_000
    });

    expect(first.collectorRunId).toBe(tardisCollectorRunId);
    expect(first.downloadedFiles).toBe(5);
    expect(first.importedParts).toBe(5);
    expect(first.parts.every((part) => part.outputPath !== null)).toBe(
      true
    );

    const parts = await discoverClosedJournalParts({
      dataRoot,
      eventTypes: new Set(["book_checkpoint", "trade"])
    });
    expect(parts).toHaveLength(5);
    expect(parts.every((part) => part.representation === "gzip")).toBe(
      true
    );
    expect(parts.every((part) => part.sourcePath === undefined)).toBe(
      true
    );

    const events = [];
    for await (const position of readMergedJournalParts(parts)) {
      events.push(position.event);
    }
    expect(events).toHaveLength(5);
    expect(
      events.every(
        (event) => event.collectorRunId === tardisCollectorRunId
      )
    ).toBe(true);
    expect(
      events.map((event) => `${event.venue}|${event.product}`)
    ).toEqual([
      "binance|EUR-USDC",
      "bybit|USDC-EUR",
      "kraken|USDC-EUR",
      "coinbase|EURC-USDC",
      "coinbase|EURC-USDC"
    ]);

    const second = await importFreeTardisHistory({
      cacheRoot,
      dataRoot,
      dates: [date],
      fetchImplementation: (() => {
        throw new Error("cache should prevent network access");
      }) as typeof fetch,
      now: () => midnightMs + 86_400_001
    });
    expect(second.cacheHits).toBe(5);
    expect(second.skippedExistingParts).toBe(5);
  });
});
