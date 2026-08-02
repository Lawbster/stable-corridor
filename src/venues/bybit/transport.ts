import {
  assertBybitProductSet,
  BYBIT_PUBLIC_SPOT_WEBSOCKET_URL,
  createBybitPingMessage,
  createBybitSubscriptionMessage,
  type BybitPublicProduct
} from "./constants.js";

export interface BybitWebSocketLike {
  onopen: (() => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onclose:
    | ((event: {
        readonly code?: number;
        readonly reason?: string;
      }) => void)
    | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type BybitWebSocketFactory = (url: string) => BybitWebSocketLike;

export interface BybitPublicWebSocketOptions {
  readonly products: readonly BybitPublicProduct[];
  readonly maxFrameBytes: number;
  readonly pingIntervalMs: number;
  readonly onFrame: (
    frame: string,
    receivedTimestampMs: number
  ) => void | Promise<void>;
  readonly onOpen?: () => void;
  readonly onClose?: (code: number | undefined, reason: string) => void;
  readonly onFatal?: (error: Error) => void;
  readonly now?: () => number;
  readonly webSocketFactory?: BybitWebSocketFactory;
  readonly setIntervalImpl?: typeof setInterval;
  readonly clearIntervalImpl?: typeof clearInterval;
}

function defaultWebSocketFactory(url: string): BybitWebSocketLike {
  return new WebSocket(url) as unknown as BybitWebSocketLike;
}

export class BybitPublicWebSocketSession {
  readonly #products: readonly BybitPublicProduct[];
  readonly #maxFrameBytes: number;
  readonly #pingIntervalMs: number;
  readonly #onFrame: BybitPublicWebSocketOptions["onFrame"];
  readonly #onOpen: BybitPublicWebSocketOptions["onOpen"];
  readonly #onClose: BybitPublicWebSocketOptions["onClose"];
  readonly #onFatal: BybitPublicWebSocketOptions["onFatal"];
  readonly #now: () => number;
  readonly #webSocketFactory: BybitWebSocketFactory;
  readonly #setInterval: typeof setInterval;
  readonly #clearInterval: typeof clearInterval;
  #socket: BybitWebSocketLike | undefined;
  #pingTimer: ReturnType<typeof setInterval> | undefined;
  #processing: Promise<void> = Promise.resolve();
  #fatalError: Error | undefined;

  constructor(options: BybitPublicWebSocketOptions) {
    assertBybitProductSet(options.products);
    if (
      !Number.isSafeInteger(options.maxFrameBytes) ||
      options.maxFrameBytes < 1
    ) {
      throw new Error(
        `Invalid Bybit maxFrameBytes: ${options.maxFrameBytes}`
      );
    }
    if (
      !Number.isSafeInteger(options.pingIntervalMs) ||
      options.pingIntervalMs < 1
    ) {
      throw new Error(
        `Invalid Bybit pingIntervalMs: ${options.pingIntervalMs}`
      );
    }

    this.#products = [...options.products];
    this.#maxFrameBytes = options.maxFrameBytes;
    this.#pingIntervalMs = options.pingIntervalMs;
    this.#onFrame = options.onFrame;
    this.#onOpen = options.onOpen;
    this.#onClose = options.onClose;
    this.#onFatal = options.onFatal;
    this.#now = options.now ?? Date.now;
    this.#webSocketFactory =
      options.webSocketFactory ?? defaultWebSocketFactory;
    this.#setInterval = options.setIntervalImpl ?? setInterval;
    this.#clearInterval = options.clearIntervalImpl ?? clearInterval;
  }

  get started(): boolean {
    return this.#socket !== undefined;
  }

  start(): void {
    if (this.#socket !== undefined) {
      throw new Error("Bybit public WebSocket session already started");
    }

    const socket = this.#webSocketFactory(
      BYBIT_PUBLIC_SPOT_WEBSOCKET_URL
    );
    this.#socket = socket;

    socket.onopen = () => {
      try {
        socket.send(
          JSON.stringify(createBybitSubscriptionMessage(this.#products))
        );
        this.#pingTimer = this.#setInterval(() => {
          try {
            socket.send(JSON.stringify(createBybitPingMessage()));
          } catch (error) {
            this.#fail(error);
          }
        }, this.#pingIntervalMs);
        this.#pingTimer.unref?.();
        this.#onOpen?.();
      } catch (error) {
        this.#fail(error);
      }
    };

    socket.onmessage = (event) => {
      const receivedTimestampMs = this.#now();
      if (typeof event.data !== "string") {
        this.#fail(new Error("Bybit WebSocket frame was not text"));
        return;
      }
      const frame = event.data;
      if (Buffer.byteLength(frame) > this.#maxFrameBytes) {
        this.#fail(
          new Error(
            `Bybit WebSocket frame exceeded ${this.#maxFrameBytes} bytes`
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
          : new Error("Bybit public WebSocket error")
      );
    };

    socket.onclose = (event) => {
      this.#clearPingTimer();
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
    this.#clearPingTimer();
    socket?.close(code, reason);
  }

  #clearPingTimer(): void {
    if (this.#pingTimer !== undefined) {
      this.#clearInterval(this.#pingTimer);
      this.#pingTimer = undefined;
    }
  }

  #fail(error: unknown): void {
    if (this.#fatalError !== undefined) {
      return;
    }
    this.#fatalError =
      error instanceof Error ? error : new Error(String(error));
    this.#clearPingTimer();
    this.#onFatal?.(this.#fatalError);
    this.#socket?.close(1011, "collector_failure");
  }
}
