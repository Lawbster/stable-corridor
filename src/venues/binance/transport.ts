import {
  assertBinanceProductSet,
  createBinancePublicWebSocketUrl,
  type BinancePublicProduct
} from "./constants.js";
import { PUBLIC_FEED_FAILURE_CLOSE_CODE } from "../websocket-close.js";

export interface BinanceWebSocketLike {
  onopen: (() => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onclose:
    | ((event: {
        readonly code?: number;
        readonly reason?: string;
      }) => void)
    | null;
  onerror: ((event: unknown) => void) | null;
  close(code?: number, reason?: string): void;
}

export type BinanceWebSocketFactory = (
  url: string
) => BinanceWebSocketLike;

export interface BinancePublicWebSocketOptions {
  readonly products: readonly BinancePublicProduct[];
  readonly maxFrameBytes: number;
  readonly onFrame: (
    frame: string,
    receivedTimestampMs: number
  ) => void | Promise<void>;
  readonly onOpen?: () => void;
  readonly onClose?: (code: number | undefined, reason: string) => void;
  readonly onFatal?: (error: Error) => void;
  readonly now?: () => number;
  readonly webSocketFactory?: BinanceWebSocketFactory;
}

function defaultWebSocketFactory(url: string): BinanceWebSocketLike {
  return new WebSocket(url) as unknown as BinanceWebSocketLike;
}

export class BinancePublicWebSocketSession {
  readonly #products: readonly BinancePublicProduct[];
  readonly #maxFrameBytes: number;
  readonly #onFrame: BinancePublicWebSocketOptions["onFrame"];
  readonly #onOpen: BinancePublicWebSocketOptions["onOpen"];
  readonly #onClose: BinancePublicWebSocketOptions["onClose"];
  readonly #onFatal: BinancePublicWebSocketOptions["onFatal"];
  readonly #now: () => number;
  readonly #webSocketFactory: BinanceWebSocketFactory;
  #socket: BinanceWebSocketLike | undefined;
  #processing: Promise<void> = Promise.resolve();
  #fatalError: Error | undefined;

  constructor(options: BinancePublicWebSocketOptions) {
    assertBinanceProductSet(options.products);
    if (
      !Number.isSafeInteger(options.maxFrameBytes) ||
      options.maxFrameBytes < 1
    ) {
      throw new Error(
        `Invalid Binance maxFrameBytes: ${options.maxFrameBytes}`
      );
    }

    this.#products = [...options.products];
    this.#maxFrameBytes = options.maxFrameBytes;
    this.#onFrame = options.onFrame;
    this.#onOpen = options.onOpen;
    this.#onClose = options.onClose;
    this.#onFatal = options.onFatal;
    this.#now = options.now ?? Date.now;
    this.#webSocketFactory =
      options.webSocketFactory ?? defaultWebSocketFactory;
  }

  get started(): boolean {
    return this.#socket !== undefined;
  }

  start(): void {
    if (this.#socket !== undefined) {
      throw new Error("Binance public WebSocket session already started");
    }

    const socket = this.#webSocketFactory(
      createBinancePublicWebSocketUrl(this.#products)
    );
    this.#socket = socket;

    socket.onopen = () => {
      try {
        this.#onOpen?.();
      } catch (error) {
        this.#fail(error);
      }
    };

    socket.onmessage = (event) => {
      const receivedTimestampMs = this.#now();
      if (typeof event.data !== "string") {
        this.#fail(new Error("Binance WebSocket frame was not text"));
        return;
      }
      const frame = event.data;
      if (Buffer.byteLength(frame) > this.#maxFrameBytes) {
        this.#fail(
          new Error(
            `Binance WebSocket frame exceeded ${this.#maxFrameBytes} bytes`
          )
        );
        return;
      }

      const operation = this.#processing.then(async () => {
        if (this.#fatalError !== undefined) {
          throw this.#fatalError;
        }
        await this.#onFrame(frame, receivedTimestampMs);
      });
      this.#processing = operation.catch((error: unknown) => {
        this.#fail(error);
      });
    };

    socket.onerror = (event) => {
      this.#fail(
        event instanceof Error
          ? event
          : new Error("Binance public WebSocket error")
      );
    };

    socket.onclose = (event) => {
      this.#socket = undefined;
      this.#onClose?.(event.code, event.reason ?? "");
    };
  }

  async drain(): Promise<void> {
    await this.#processing;
    if (this.#fatalError !== undefined) {
      throw this.#fatalError;
    }
  }

  stop(code = 1000, reason = "collector_stop"): void {
    const socket = this.#socket;
    this.#socket = undefined;
    socket?.close(code, reason);
  }

  #fail(error: unknown): void {
    if (this.#fatalError !== undefined) {
      return;
    }
    this.#fatalError =
      error instanceof Error ? error : new Error(String(error));
    this.#onFatal?.(this.#fatalError);
    this.#socket?.close(
      PUBLIC_FEED_FAILURE_CLOSE_CODE,
      "collector_failure"
    );
  }
}
