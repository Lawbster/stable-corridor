import {
  link,
  mkdir,
  open,
  rename,
  unlink,
  type FileHandle
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

async function syncDirectoryBestEffort(directory: string): Promise<void> {
  if (process.platform === "win32") {
    return;
  }

  let handle: FileHandle | undefined;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch {
    // Directory fsync is not supported by every filesystem.
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function writeFileAtomic(
  targetPath: string,
  contents: string | Uint8Array,
  mode = 0o600
): Promise<void> {
  const directory = dirname(targetPath);
  const temporaryPath = join(
    directory,
    `.${basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`
  );
  let handle: FileHandle | undefined;

  await mkdir(directory, { recursive: true });

  try {
    handle = await open(temporaryPath, "wx", mode);
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, targetPath);
    await syncDirectoryBestEffort(directory);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export async function writeFileAtomicExclusive(
  targetPath: string,
  contents: string | Uint8Array,
  mode = 0o600
): Promise<void> {
  const directory = dirname(targetPath);
  const temporaryPath = join(
    directory,
    `.${basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`
  );
  let handle: FileHandle | undefined;

  await mkdir(directory, { recursive: true });

  try {
    handle = await open(temporaryPath, "wx", mode);
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await link(temporaryPath, targetPath);
    await unlink(temporaryPath);
    await syncDirectoryBestEffort(directory);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}
