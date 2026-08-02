import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  measureStorage,
  storageLimitReason
} from "../../src/collector/runtime/storage.js";
import {
  createTestDirectory,
  removeTestDirectory
} from "../fixtures/temp-directory.js";

const testDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(testDirectories.splice(0).map(removeTestDirectory));
});

describe("collector storage gate", () => {
  it("measures data bytes and reports each hard limit", async () => {
    const dataRoot = await createTestDirectory();
    testDirectories.push(dataRoot);
    await writeFile(join(dataRoot, "sample.bin"), Buffer.alloc(17));

    const measurement = await measureStorage(dataRoot);

    expect(measurement.dataRootBytes).toBe(17);
    expect(measurement.diskFreeBytes).toBeGreaterThan(0);
    expect(
      storageLimitReason(measurement, {
        maxDataBytes: 17,
        minFreeBytes: 1
      })
    ).toBe("storage_data_limit");
    expect(
      storageLimitReason(measurement, {
        maxDataBytes: 18,
        minFreeBytes: measurement.diskFreeBytes + 1
      })
    ).toBe("storage_free_reserve");
    expect(
      storageLimitReason(measurement, {
        maxDataBytes: 18,
        minFreeBytes: 1
      })
    ).toBeNull();
  });
});
