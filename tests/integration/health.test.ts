import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  publishCollectorHealthAtomic,
  tryPublishCollectorHealthAtomic
} from "../../src/health/atomic-publisher.js";
import type { CollectorHealth } from "../../src/health/schema.js";
import { makeCollectorHealth } from "../fixtures/health.js";
import {
  createTestDirectory,
  removeTestDirectory
} from "../fixtures/temp-directory.js";

const testDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(testDirectories.splice(0).map(removeTestDirectory));
});

describe("atomic collector health publication", () => {
  it("publishes valid canonical health without leaving temporary files", async () => {
    const directory = await createTestDirectory();
    testDirectories.push(directory);
    const target = join(directory, "state", "collector-health.json");

    await publishCollectorHealthAtomic(target, makeCollectorHealth());

    const parsed = JSON.parse(await readFile(target, "utf8"));
    expect(parsed.status).toBe("healthy");
    expect(await readdir(join(directory, "state"))).toEqual([
      "collector-health.json"
    ]);
  });

  it("preserves the previous snapshot when validation fails", async () => {
    const directory = await createTestDirectory();
    testDirectories.push(directory);
    const target = join(directory, "state", "collector-health.json");
    const valid = makeCollectorHealth();
    await publishCollectorHealthAtomic(target, valid);
    const before = await readFile(target, "utf8");

    const invalid = {
      ...valid,
      status: "alive"
    } as unknown as CollectorHealth;
    const result = await tryPublishCollectorHealthAtomic(target, invalid);

    expect(result.success).toBe(false);
    expect(await readFile(target, "utf8")).toBe(before);
  });
});
