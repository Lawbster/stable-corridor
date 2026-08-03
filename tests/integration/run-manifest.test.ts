import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseCollectorConfig } from "../../src/collector/config.js";
import {
  collectorRunEndManifestSchema,
  collectorRunStartManifestSchema,
  writeCollectorRunEndManifest,
  writeCollectorRunStartManifest
} from "../../src/collector/runtime/run-manifest.js";
import { canonicalJsonLine } from "../../src/collector/serialization.js";
import {
  createTestDirectory,
  removeTestDirectory
} from "../fixtures/temp-directory.js";

const testDirectories: string[] = [];
const collectorRunId = "11111111-1111-4111-8111-111111111111";
const startedAtMs = Date.UTC(2026, 7, 3, 12, 0, 0);

afterEach(async () => {
  await Promise.all(testDirectories.splice(0).map(removeTestDirectory));
});

describe("collector run manifests", () => {
  it("writes immutable start and end records inside the data root", async () => {
    const root = await createTestDirectory();
    testDirectories.push(root);
    const dataRoot = join(root, "data");
    const example = JSON.parse(
      await readFile(resolve("config/collector.example.json"), "utf8")
    ) as Record<string, unknown>;
    const config = parseCollectorConfig({
      ...example,
      dataRoot,
      healthFile: join(root, "state", "collector-health.json")
    });
    const start = await writeCollectorRunStartManifest({
      dataRoot,
      collectorRunId,
      commitSha: "8e74d41e29ce02f0516739dba79d278bd320ea89",
      configHash:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      config,
      startedAtMs
    });
    const end = await writeCollectorRunEndManifest({
      dataRoot,
      collectorRunId,
      startedAtMs,
      stoppedAtMs: startedAtMs + 60_000,
      stopReason: "operator_stop",
      exitCode: 0,
      journalErrorCount: 0
    });
    const directory = join(dataRoot, "runs", collectorRunId);

    expect(
      collectorRunStartManifestSchema.parse(
        JSON.parse(await readFile(join(directory, "start.json"), "utf8"))
      )
    ).toEqual(start);
    expect(
      collectorRunEndManifestSchema.parse(
        JSON.parse(await readFile(join(directory, "end.json"), "utf8"))
      )
    ).toEqual(end);
    expect(await readFile(join(directory, "start.json"), "utf8")).toBe(
      canonicalJsonLine(start)
    );
    await expect(
      writeCollectorRunStartManifest({
        dataRoot,
        collectorRunId,
        commitSha: null,
        configHash:
          "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        config,
        startedAtMs
      })
    ).rejects.toMatchObject({ code: "EEXIST" });
  });
});
