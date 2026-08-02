import {
  parseNormalizedEvent,
  type NormalizedEvent,
  type NormalizedEventType
} from "../schema/events.js";
import type { FeedHealth } from "../../health/types.js";
import { JournalStreamWriter } from "../journal/writer.js";

export interface CollectorEventSinkOptions {
  readonly dataRoot: string;
  readonly maxPartBytes: number;
  readonly syncEveryAppend: boolean;
  readonly initialIngestSequence?: number;
}

interface FeedObservation {
  lastReceivedAtMs: number | null;
  lastSourceAtMs: number | null;
  venueSequence: string | null;
  connectionState:
    | "connecting"
    | "healthy"
    | "stale"
    | "gapped"
    | "recovering"
    | "stopped";
  eligibleForResearch: boolean;
}

export interface FeedDiagnostic {
  readonly venue: string;
  readonly product: string;
  readonly connectionState: FeedObservation["connectionState"];
  readonly venueSequence: string | null;
  readonly gapCount: number;
  readonly reconnectCount: number;
  readonly crossedBookCount: number;
  readonly eligibleForResearch: boolean;
}

function writerKey(event: NormalizedEvent): string {
  return `${event.venue}\u0000${event.product}\u0000${event.eventType}`;
}

function feedKey(venue: string, product: string): string {
  return `${venue}\u0000${product}`;
}

export class CollectorEventSink {
  readonly #options: CollectorEventSinkOptions;
  readonly #writers = new Map<string, JournalStreamWriter>();
  readonly #observations = new Map<string, FeedObservation>();
  #queue: Promise<void> = Promise.resolve();
  #nextIngestSequence: number;
  #closed = false;
  #journalLastWriteAtMs: number | null = null;
  #journalErrorCount = 0;

  constructor(options: CollectorEventSinkOptions) {
    this.#options = options;
    this.#nextIngestSequence = options.initialIngestSequence ?? 0;
    if (
      !Number.isSafeInteger(this.#nextIngestSequence) ||
      this.#nextIngestSequence < 0
    ) {
      throw new Error(
        `Invalid initial ingest sequence: ${this.#nextIngestSequence}`
      );
    }
  }

  get journalLastWriteAtMs(): number | null {
    return this.#journalLastWriteAtMs;
  }

  get journalErrorCount(): number {
    return this.#journalErrorCount;
  }

  append(events: readonly NormalizedEvent[]): Promise<void> {
    if (this.#closed) {
      return Promise.reject(new Error("Collector event sink is closed"));
    }
    const operation = this.#queue.then(async () => {
      for (const event of events) {
        if (this.#nextIngestSequence === Number.MAX_SAFE_INTEGER) {
          throw new Error("Collector ingest sequence exhausted");
        }
        const normalized = parseNormalizedEvent({
          ...event,
          ingestSequence: this.#nextIngestSequence
        });
        this.#nextIngestSequence += 1;
        let writer = this.#writers.get(writerKey(normalized));
        if (writer === undefined) {
          writer = new JournalStreamWriter({
            dataRoot: this.#options.dataRoot,
            venue: normalized.venue,
            product: normalized.product,
            eventType: normalized.eventType,
            maxPartBytes: this.#options.maxPartBytes,
            syncEveryAppend: this.#options.syncEveryAppend
          });
          this.#writers.set(writerKey(normalized), writer);
        }
        await writer.append(normalized);
        this.#journalLastWriteAtMs = Math.max(
          this.#journalLastWriteAtMs ?? 0,
          normalized.receivedTimestampMs
        );
        this.#observe(normalized);
      }
    });
    this.#queue = operation.catch(() => {
      this.#journalErrorCount += 1;
    });
    return operation;
  }

  feedHealth(
    diagnostics: readonly FeedDiagnostic[],
    nowTimestampMs: number
  ): readonly FeedHealth[] {
    return diagnostics.map((diagnostic) => {
      const observation = this.#observations.get(
        feedKey(diagnostic.venue, diagnostic.product)
      );
      const lastReceivedAtMs =
        observation?.lastReceivedAtMs ?? null;
      return {
        venue: diagnostic.venue,
        product: diagnostic.product,
        connectionState: diagnostic.connectionState,
        lastReceivedAtMs,
        lastSourceAtMs: observation?.lastSourceAtMs ?? null,
        receiveAgeMs:
          lastReceivedAtMs === null
            ? null
            : Math.max(0, nowTimestampMs - lastReceivedAtMs),
        venueSequence:
          diagnostic.venueSequence ??
          observation?.venueSequence ??
          null,
        gapCount: diagnostic.gapCount,
        reconnectCount: diagnostic.reconnectCount,
        crossedBookCount: diagnostic.crossedBookCount,
        eligibleForResearch: diagnostic.eligibleForResearch
      };
    });
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    await this.#queue;
    await Promise.all(
      [...this.#writers.values()].map(async (writer) => writer.close())
    );
  }

  #observe(event: NormalizedEvent): void {
    const key = feedKey(event.venue, event.product);
    const previous = this.#observations.get(key);
    const observation: FeedObservation = {
      lastReceivedAtMs: event.receivedTimestampMs,
      lastSourceAtMs:
        event.sourceTimestampMs ?? previous?.lastSourceAtMs ?? null,
      venueSequence:
        event.venueSequence ?? previous?.venueSequence ?? null,
      connectionState:
        previous?.connectionState ?? "connecting",
      eligibleForResearch:
        previous?.eligibleForResearch ?? false
    };
    if (event.eventType === "feed_status") {
      observation.connectionState = event.payload.state;
      observation.eligibleForResearch =
        event.payload.eligibleForResearch;
    }
    this.#observations.set(key, observation);
  }
}

export type { FeedHealth } from "../../health/types.js";
export type { NormalizedEventType };
