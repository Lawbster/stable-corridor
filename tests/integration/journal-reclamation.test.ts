import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  appendFile,
  readFile,
  readdir,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  compressClosedJournals
} from "../../src/collector/journal/compression.js";
import {
  applyJournalSourceReclamationPlan,
  journalSourceReclamationPlanSchema,
  writeJournalSourceReclamationPlan
} from "../../src/collector/journal/reclamation.js";
import {
  journalDirectory
} from "../../src/collector/journal/path.js";
import { JournalStreamWriter } from "../../src/collector/journal/writer.js";
import { makeTradeEvent } from "../fixtures/events.js";
import {
  createTestDirectory,
  removeTestDirectory
} from "../fixtures/temp-directory.js";

const execFileAsync = promisify(execFile);
const testDirectories: string[] = [];
const receivedTimestampMs = Date.UTC(2026, 7, 5, 12, 0, 0);
const planTimestampMs = receivedTimestampMs + 10_000;
const route = {
  venue: "coinbase",
  product: "EURC-USDC",
  eventType: "trade" as const
};

afterEach(async () => {
  await Promise.all(testDirectories.splice(0).map(removeTestDirectory));
});

async function writeOnePart(
  dataRoot: string,
  ingestSequence = 0
): Promise<string> {
  const writer = new JournalStreamWriter({
    dataRoot,
    ...route,
    maxPartBytes: 1024 * 1024,
    syncEveryAppend: true,
    now: () => receivedTimestampMs + 1_000
  });
  await writer.append(
    makeTradeEvent({
      receivedTimestampMs: receivedTimestampMs + ingestSequence,
      ingestSequence
    })
  );
  await writer.close();
  const part = ingestSequence + 1;
  return join(
    journalDirectory(dataRoot, "2026-08-05", route),
    `trade-${part.toString().padStart(6, "0")}.jsonl`
  );
}

async function prepareCompressedPart(root: string): Promise<{
  readonly dataRoot: string;
  readonly planPath: string;
  readonly sourcePath: string;
}> {
  const dataRoot = join(root, "data");
  const planPath = join(root, "state", "source-reclamation-plan.json");
  const sourcePath = await writeOnePart(dataRoot);
  await compressClosedJournals({
    dataRoot,
    now: () => receivedTimestampMs + 2_000
  });
  return { dataRoot, planPath, sourcePath };
}

describe("closed journal source reclamation", () => {
  it("writes a deterministic verified plan without changing sources", async () => {
    const root = await createTestDirectory();
    testDirectories.push(root);
    const { dataRoot, planPath, sourcePath } =
      await prepareCompressedPart(root);
    const sourceBefore = await readFile(sourcePath);

    const first = await writeJournalSourceReclamationPlan({
      dataRoot,
      planPath,
      now: () => planTimestampMs
    });
    const second = await writeJournalSourceReclamationPlan({
      dataRoot,
      planPath,
      now: () => planTimestampMs
    });
    const stored = journalSourceReclamationPlanSchema.parse(
      JSON.parse(await readFile(planPath, "utf8"))
    );

    expect(first).toEqual(second);
    expect(stored).toEqual(first);
    expect(first).toMatchObject({
      recordType: "journal_source_reclamation_plan",
      entryCount: 1,
      totalSourceBytes: sourceBefore.length
    });
    expect(first.planSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(await readFile(sourcePath)).toEqual(sourceBefore);
    await expect(stat(`${planPath}.lock`)).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("requires the exact plan checksum and leaves the source intact", async () => {
    const root = await createTestDirectory();
    testDirectories.push(root);
    const { dataRoot, planPath, sourcePath } =
      await prepareCompressedPart(root);
    await writeJournalSourceReclamationPlan({
      dataRoot,
      planPath,
      now: () => planTimestampMs
    });

    await expect(
      applyJournalSourceReclamationPlan({
        dataRoot,
        planPath,
        confirmPlanSha256: "0".repeat(64)
      })
    ).rejects.toThrow(/Confirmation checksum mismatch/u);
    expect((await stat(sourcePath)).isFile()).toBe(true);
  });

  it("removes only the source and leaves a gzip-only auditable part", async () => {
    const root = await createTestDirectory();
    testDirectories.push(root);
    const { dataRoot, planPath, sourcePath } =
      await prepareCompressedPart(root);
    const plan = await writeJournalSourceReclamationPlan({
      dataRoot,
      planPath,
      now: () => planTimestampMs
    });

    const result = await applyJournalSourceReclamationPlan({
      dataRoot,
      planPath,
      confirmPlanSha256: plan.planSha256,
      now: () => planTimestampMs + 1_000
    });
    expect(result).toMatchObject({
      plannedParts: 1,
      deletedThisRunParts: 1,
      alreadyReclaimedParts: 0,
      reclaimedSourceBytes: plan.totalSourceBytes
    });
    await expect(stat(sourcePath)).rejects.toMatchObject({ code: "ENOENT" });
    for (const retainedPath of [
      `${sourcePath}.meta.json`,
      `${sourcePath}.gz`,
      `${sourcePath}.gz.meta.json`,
      `${planPath}.applied.json`
    ]) {
      expect((await stat(retainedPath)).isFile()).toBe(true);
    }

    const reportPath = join(root, "state", "dataset-audit.json");
    await execFileAsync(process.execPath, [
      resolve("scripts/audit-dataset.mjs"),
      "--data-root",
      dataRoot,
      "--output",
      reportPath,
      "--compression",
      "none"
    ]);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(report).toMatchObject({
      integrity: {
        passed: true,
        closedParts: 1,
        verifiedClosedParts: 1
      },
      storedCompression: {
        verifiedCompressedParts: 1,
        sourcePresentParts: 0,
        compressedOnlyParts: 1
      }
    });
  });

  it("is idempotent after a completed or interrupted apply", async () => {
    const root = await createTestDirectory();
    testDirectories.push(root);
    const { dataRoot, planPath } = await prepareCompressedPart(root);
    const plan = await writeJournalSourceReclamationPlan({
      dataRoot,
      planPath,
      now: () => planTimestampMs
    });

    await applyJournalSourceReclamationPlan({
      dataRoot,
      planPath,
      confirmPlanSha256: plan.planSha256
    });
    const repeated = await applyJournalSourceReclamationPlan({
      dataRoot,
      planPath,
      confirmPlanSha256: plan.planSha256
    });
    expect(repeated).toMatchObject({
      plannedParts: 1,
      deletedThisRunParts: 0,
      alreadyReclaimedParts: 1,
      deletedThisRunBytes: 0
    });
    await expect(
      writeJournalSourceReclamationPlan({
        dataRoot,
        planPath,
        now: () => planTimestampMs + 1
      })
    ).rejects.toThrow(/completion record already exists/u);
  });

  it("completes preflight before deleting when a gzip was altered", async () => {
    const root = await createTestDirectory();
    testDirectories.push(root);
    const dataRoot = join(root, "data");
    const planPath = join(root, "state", "source-reclamation-plan.json");
    const firstSourcePath = await writeOnePart(dataRoot, 0);
    const secondSourcePath = await writeOnePart(dataRoot, 1);
    await compressClosedJournals({ dataRoot });
    const plan = await writeJournalSourceReclamationPlan({
      dataRoot,
      planPath,
      now: () => planTimestampMs
    });
    await writeFile(`${secondSourcePath}.gz`, "not a gzip");

    await expect(
      applyJournalSourceReclamationPlan({
        dataRoot,
        planPath,
        confirmPlanSha256: plan.planSha256
      })
    ).rejects.toThrow();
    expect((await stat(firstSourcePath)).isFile()).toBe(true);
    expect((await stat(secondSourcePath)).isFile()).toBe(true);
  });

  it("rejects a source that changed after planning", async () => {
    const root = await createTestDirectory();
    testDirectories.push(root);
    const { dataRoot, planPath, sourcePath } =
      await prepareCompressedPart(root);
    const plan = await writeJournalSourceReclamationPlan({
      dataRoot,
      planPath,
      now: () => planTimestampMs
    });
    await appendFile(sourcePath, "{}\n");

    await expect(
      applyJournalSourceReclamationPlan({
        dataRoot,
        planPath,
        confirmPlanSha256: plan.planSha256
      })
    ).rejects.toThrow(/Source bytes mismatch/u);
    expect((await stat(sourcePath)).isFile()).toBe(true);
  });

  it("rejects an open sibling and a checksum-invalid plan", async () => {
    const root = await createTestDirectory();
    testDirectories.push(root);
    const { dataRoot, planPath, sourcePath } =
      await prepareCompressedPart(root);
    await writeFile(`${sourcePath}.open`, "");
    await expect(
      writeJournalSourceReclamationPlan({
        dataRoot,
        planPath,
        now: () => planTimestampMs
      })
    ).rejects.toThrow(/Unexpected mutable journal sibling/u);
    await unlink(`${sourcePath}.open`);

    const plan = await writeJournalSourceReclamationPlan({
      dataRoot,
      planPath,
      now: () => planTimestampMs
    });
    const tampered = {
      ...plan,
      totalSourceBytes: plan.totalSourceBytes + 1
    };
    await writeFile(planPath, `${JSON.stringify(tampered)}\n`);
    await expect(
      applyJournalSourceReclamationPlan({
        dataRoot,
        planPath,
        confirmPlanSha256: plan.planSha256
      })
    ).rejects.toThrow(/plan checksum mismatch/ui);
    expect((await stat(sourcePath)).isFile()).toBe(true);
  });

  it("does not touch compressed parts created after a bounded plan", async () => {
    const root = await createTestDirectory();
    testDirectories.push(root);
    const dataRoot = join(root, "data");
    const planPath = join(root, "state", "source-reclamation-plan.json");
    const firstSourcePath = await writeOnePart(dataRoot, 0);
    await compressClosedJournals({ dataRoot });
    const plan = await writeJournalSourceReclamationPlan({
      dataRoot,
      planPath,
      maxParts: 1,
      now: () => planTimestampMs
    });
    const secondSourcePath = await writeOnePart(dataRoot, 1);
    await compressClosedJournals({ dataRoot });

    await applyJournalSourceReclamationPlan({
      dataRoot,
      planPath,
      confirmPlanSha256: plan.planSha256
    });
    await expect(stat(firstSourcePath)).rejects.toMatchObject({
      code: "ENOENT"
    });
    expect((await stat(secondSourcePath)).isFile()).toBe(true);
    expect(await readdir(dirname(secondSourcePath))).toContain(
      "trade-000002.jsonl"
    );
  });
});
