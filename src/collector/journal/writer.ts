import {
  mkdir,
  open,
  readdir,
  rename,
  stat,
  unlink,
  type FileHandle
} from "node:fs/promises";
import { join } from "node:path";

import {
  parseNormalizedEvent,
  type NormalizedEvent,
  type NormalizedEventType
} from "../schema/events.js";
import { canonicalJsonLine } from "../serialization.js";
import {
  inspectClosedJournal,
  writeJournalPartMetadata
} from "./metadata.js";
import {
  assertSafePathSegment,
  formatUtcDate,
  journalDirectory,
  journalPartBaseName,
  type JournalRoute
} from "./path.js";
import { recoverOpenJsonLines } from "./recovery.js";

export interface JournalStreamWriterOptions {
  readonly dataRoot: string;
  readonly venue: string;
  readonly product: string;
  readonly eventType: NormalizedEventType;
  readonly maxPartBytes: number;
  readonly syncEveryAppend: boolean;
  readonly now?: () => number;
}

interface OpenPart {
  readonly date: string;
  readonly part: number;
  readonly directory: string;
  readonly openPath: string;
  readonly closedPath: string;
  readonly metadataPath: string;
  readonly handle: FileHandle;
  bytes: number;
}

const closedSuffix = ".jsonl";
const openSuffix = ".jsonl.open";

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function partNumberFromName(
  fileName: string,
  eventType: NormalizedEventType
): number | undefined {
  const pattern = new RegExp(
    `^${escapeRegularExpression(eventType)}-(\\d{6})\\.jsonl(?:\\.open|\\.gz)?$`,
    "u"
  );
  const match = pattern.exec(fileName);
  if (match?.[1] === undefined) {
    return undefined;
  }
  return Number.parseInt(match[1], 10);
}

export class JournalStreamWriter {
  readonly #dataRoot: string;
  readonly #route: JournalRoute;
  readonly #maxPartBytes: number;
  readonly #syncEveryAppend: boolean;
  readonly #now: () => number;
  #current: OpenPart | undefined;
  #queue: Promise<void> = Promise.resolve();
  #fatalError: Error | undefined;
  #closed = false;

  constructor(options: JournalStreamWriterOptions) {
    assertSafePathSegment(options.venue, "venue");
    assertSafePathSegment(options.product, "product");
    assertSafePathSegment(options.eventType, "event type");

    if (
      !Number.isSafeInteger(options.maxPartBytes) ||
      options.maxPartBytes < 1
    ) {
      throw new Error(`Invalid maxPartBytes: ${options.maxPartBytes}`);
    }

    this.#dataRoot = options.dataRoot;
    this.#route = {
      venue: options.venue,
      product: options.product,
      eventType: options.eventType
    };
    this.#maxPartBytes = options.maxPartBytes;
    this.#syncEveryAppend = options.syncEveryAppend;
    this.#now = options.now ?? Date.now;
  }

  append(input: unknown): Promise<void> {
    if (this.#closed) {
      return Promise.reject(new Error("Journal writer is closed"));
    }

    const operation = this.#queue.then(async () => {
      if (this.#fatalError !== undefined) {
        throw this.#fatalError;
      }

      try {
        await this.#appendInner(input);
      } catch (error) {
        this.#fatalError =
          error instanceof Error ? error : new Error(String(error));
        throw this.#fatalError;
      }
    });
    this.#queue = operation.catch(() => undefined);
    return operation;
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    await this.#queue;

    if (this.#fatalError !== undefined) {
      await this.#closeOpenHandleAfterFailure();
      throw this.#fatalError;
    }

    if (this.#current !== undefined) {
      await this.#finalizeCurrent();
    }
  }

  async #appendInner(input: unknown): Promise<void> {
    const event = parseNormalizedEvent(input);
    this.#assertRoute(event);
    const date = formatUtcDate(event.receivedTimestampMs);
    const line = canonicalJsonLine(event);
    const lineBytes = Buffer.byteLength(line);

    if (this.#current !== undefined && date < this.#current.date) {
      throw new Error(
        `Journal date moved backwards from ${this.#current.date} to ${date}`
      );
    }

    if (this.#current === undefined || date !== this.#current.date) {
      if (this.#current !== undefined) {
        await this.#finalizeCurrent();
      }
      this.#current = await this.#openNextPart(date);
    }

    if (
      this.#current.bytes > 0 &&
      this.#current.bytes + lineBytes > this.#maxPartBytes
    ) {
      const nextPart = this.#current.part + 1;
      const currentDate = this.#current.date;
      await this.#finalizeCurrent();
      this.#current = await this.#openPart(currentDate, nextPart);
    }

    await this.#current.handle.writeFile(line, { encoding: "utf8" });
    if (this.#syncEveryAppend) {
      await this.#current.handle.sync();
    }
    this.#current.bytes += lineBytes;
  }

  #assertRoute(event: NormalizedEvent): void {
    if (
      event.venue !== this.#route.venue ||
      event.product !== this.#route.product ||
      event.eventType !== this.#route.eventType
    ) {
      throw new Error(
        `Event route ${event.venue}/${event.product}/${event.eventType} does not match writer route ${this.#route.venue}/${this.#route.product}/${this.#route.eventType}`
      );
    }
  }

  async #openNextPart(date: string): Promise<OpenPart> {
    const directory = journalDirectory(this.#dataRoot, date, this.#route);
    await mkdir(directory, { recursive: true });
    const entries = await readdir(directory);
    let highestPart = 0;

    for (const entry of entries) {
      const part = partNumberFromName(entry, this.#route.eventType);
      if (part === undefined) {
        continue;
      }
      highestPart = Math.max(highestPart, part);

      if (entry.endsWith(openSuffix)) {
        await this.#recoverOpenPart(directory, entry, date, part);
      } else if (entry.endsWith(closedSuffix)) {
        await this.#ensureMetadata(directory, entry, date, part);
      }
    }

    return this.#openPart(date, highestPart + 1);
  }

  async #recoverOpenPart(
    directory: string,
    fileName: string,
    date: string,
    part: number
  ): Promise<void> {
    const openPath = join(directory, fileName);
    const recovery = await recoverOpenJsonLines(openPath);

    if (recovery.recoveredBytes === 0) {
      await unlink(openPath);
      return;
    }

    const closedPath = openPath.slice(0, -".open".length);
    await rename(openPath, closedPath);
    await this.#ensureMetadata(
      directory,
      fileName.slice(0, -".open".length),
      date,
      part
    );
  }

  async #ensureMetadata(
    directory: string,
    closedFileName: string,
    date: string,
    part: number
  ): Promise<void> {
    const closedPath = join(directory, closedFileName);
    const metadataPath = `${closedPath}.meta.json`;

    try {
      await stat(metadataPath);
      return;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
        throw error;
      }
    }

    const metadata = await inspectClosedJournal(
      closedPath,
      this.#route,
      date,
      part,
      this.#now()
    );
    await writeJournalPartMetadata(metadataPath, metadata);
  }

  async #openPart(date: string, part: number): Promise<OpenPart> {
    const directory = journalDirectory(this.#dataRoot, date, this.#route);
    const baseName = journalPartBaseName(this.#route.eventType, part);
    const closedPath = join(directory, baseName);
    const openPath = `${closedPath}.open`;
    await mkdir(directory, { recursive: true });
    const handle = await open(openPath, "ax", 0o600);

    return {
      date,
      part,
      directory,
      openPath,
      closedPath,
      metadataPath: `${closedPath}.meta.json`,
      handle,
      bytes: 0
    };
  }

  async #finalizeCurrent(): Promise<void> {
    const current = this.#current;
    if (current === undefined) {
      return;
    }
    this.#current = undefined;

    await current.handle.sync();
    await current.handle.close();

    if (current.bytes === 0) {
      await unlink(current.openPath);
      return;
    }

    await rename(current.openPath, current.closedPath);
    const metadata = await inspectClosedJournal(
      current.closedPath,
      this.#route,
      current.date,
      current.part,
      this.#now()
    );
    await writeJournalPartMetadata(current.metadataPath, metadata);
  }

  async #closeOpenHandleAfterFailure(): Promise<void> {
    const current = this.#current;
    this.#current = undefined;
    if (current === undefined) {
      return;
    }

    await current.handle.sync().catch(() => undefined);
    await current.handle.close().catch(() => undefined);
  }
}
