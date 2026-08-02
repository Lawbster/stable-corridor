import { mkdtemp, rm } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testPrefix = "stable-corridor-test-";

export async function createTestDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), testPrefix));
}

export async function removeTestDirectory(path: string): Promise<void> {
  const resolvedTempRoot = resolve(tmpdir());
  const resolvedTarget = resolve(path);
  const relativeTarget = relative(resolvedTempRoot, resolvedTarget);

  if (
    relativeTarget.startsWith("..") ||
    !basename(resolvedTarget).startsWith(testPrefix)
  ) {
    throw new Error(`Refusing to remove unsafe test path: ${resolvedTarget}`);
  }

  await rm(resolvedTarget, { recursive: true, force: true });
}
