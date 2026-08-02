import { open } from "node:fs/promises";

export interface JournalRecoveryResult {
  readonly originalBytes: number;
  readonly recoveredBytes: number;
  readonly truncatedBytes: number;
}

const recoveryChunkBytes = 64 * 1024;

async function readFully(
  handle: Awaited<ReturnType<typeof open>>,
  buffer: Buffer,
  position: number
): Promise<void> {
  let offset = 0;

  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(
      buffer,
      offset,
      buffer.length - offset,
      position + offset
    );
    if (bytesRead === 0) {
      throw new Error("Unexpected end of file during journal recovery");
    }
    offset += bytesRead;
  }
}

export async function recoverOpenJsonLines(
  filePath: string
): Promise<JournalRecoveryResult> {
  const handle = await open(filePath, "r+");

  try {
    const { size } = await handle.stat();
    if (size === 0) {
      return {
        originalBytes: 0,
        recoveredBytes: 0,
        truncatedBytes: 0
      };
    }

    const lastByte = Buffer.allocUnsafe(1);
    await readFully(handle, lastByte, size - 1);
    if (lastByte[0] === 0x0a) {
      return {
        originalBytes: size,
        recoveredBytes: size,
        truncatedBytes: 0
      };
    }

    let searchEnd = size;
    let recoveredBytes = 0;

    while (searchEnd > 0) {
      const length = Math.min(recoveryChunkBytes, searchEnd);
      const position = searchEnd - length;
      const chunk = Buffer.allocUnsafe(length);
      await readFully(handle, chunk, position);
      const newlineIndex = chunk.lastIndexOf(0x0a);

      if (newlineIndex >= 0) {
        recoveredBytes = position + newlineIndex + 1;
        break;
      }

      searchEnd = position;
    }

    await handle.truncate(recoveredBytes);
    await handle.sync();

    return {
      originalBytes: size,
      recoveredBytes,
      truncatedBytes: size - recoveredBytes
    };
  } finally {
    await handle.close();
  }
}
