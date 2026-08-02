import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseCollectorConfig } from "../../src/collector/config.js";
import { PublicCollectorRunner } from "../../src/collector/runtime/runner.js";
import {
  createTestDirectory,
  removeTestDirectory
} from "../fixtures/temp-directory.js";

const testDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(testDirectories.splice(0).map(removeTestDirectory));
});

describe("public collector runner", () => {
  it("refuses to open network sessions when the startup storage gate fails", async () => {
    const root = await createTestDirectory();
    testDirectories.push(root);
    const dataRoot = join(root, "data");
    await mkdir(dataRoot);
    await writeFile(join(dataRoot, "sample.bin"), "x");
    const example = JSON.parse(
      await readFile(resolve("config/collector.example.json"), "utf8")
    ) as Record<string, unknown>;
    const config = parseCollectorConfig({
      ...example,
      dataRoot,
      healthFile: join(root, "state", "collector-health.json"),
      storage: {
        maxDataBytes: 1,
        minFreeBytes: 1
      }
    });
    const runner = new PublicCollectorRunner({
      config,
      log: () => undefined
    });

    await expect(runner.start()).rejects.toThrow(
      /storage gate failed.*storage_data_limit/iu
    );
  });
});
