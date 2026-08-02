import { lstat, mkdir, readdir, statfs } from "node:fs/promises";
import { join } from "node:path";

export interface StorageMeasurement {
  readonly dataRootBytes: number;
  readonly diskFreeBytes: number;
}

function safeNumber(value: bigint, label: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} exceeds JavaScript safe integer range`);
  }
  return Number(value);
}

export async function measureDirectoryBytes(root: string): Promise<number> {
  let total = 0n;

  async function visit(path: string): Promise<void> {
    const information = await lstat(path, { bigint: true });
    if (information.isSymbolicLink()) {
      throw new Error(`Runtime data path contains a symlink: ${path}`);
    }
    if (information.isFile()) {
      total += information.size;
      return;
    }
    if (!information.isDirectory()) {
      return;
    }
    for (const entry of await readdir(path)) {
      await visit(join(path, entry));
    }
  }

  await visit(root);
  return safeNumber(total, "Runtime data size");
}

export async function measureStorage(
  dataRoot: string
): Promise<StorageMeasurement> {
  await mkdir(dataRoot, { recursive: true, mode: 0o700 });
  const [dataRootBytes, filesystem] = await Promise.all([
    measureDirectoryBytes(dataRoot),
    statfs(dataRoot, { bigint: true })
  ]);
  return {
    dataRootBytes,
    diskFreeBytes: safeNumber(
      filesystem.bavail * filesystem.bsize,
      "Filesystem free bytes"
    )
  };
}

export function storageLimitReason(
  measurement: StorageMeasurement,
  limits: {
    readonly maxDataBytes: number;
    readonly minFreeBytes: number;
  }
): string | null {
  if (measurement.dataRootBytes >= limits.maxDataBytes) {
    return "storage_data_limit";
  }
  if (measurement.diskFreeBytes < limits.minFreeBytes) {
    return "storage_free_reserve";
  }
  return null;
}
