import { describe, expect, it, vi } from "vitest";

import {
  createBinancePublicWebSocketUrl
} from "../../src/venues/binance/constants.js";
import {
  BinancePublicWebSocketSession,
  type BinanceWebSocketLike
} from "../../src/venues/binance/transport.js";

class FakeWebSocket implements BinanceWebSocketLike {
  onopen: (() => void) | null = null;
  onmessage:
    | ((event: { readonly data: unknown }) => void)
    | null = null;
  onclose:
    | ((event: {
        readonly code?: number;
        readonly reason?: string;
      }) => void)
    | null = null;
  onerror: ((event: unknown) => void) | null = null;
  readonly closes: Array<{
    readonly code: number | undefined;
    readonly reason: string | undefined;
  }> = [];

  close(code?: number, reason?: string): void {
    this.closes.push({ code, reason });
  }

  emitOpen(): void {
    this.onopen?.();
  }

  emitMessage(data: unknown): void {
    this.onmessage?.({ data });
  }

  emitClose(code?: number, reason?: string): void {
    this.onclose?.({
      ...(code === undefined ? {} : { code }),
      ...(reason === undefined ? {} : { reason })
    });
  }
}

describe("Binance public WebSocket session", () => {
  it("uses only fixed public combined streams and serializes frames", async () => {
    const socket = new FakeWebSocket();
    const factory = vi.fn(() => socket);
    const onOpen = vi.fn();
    const frames: Array<{
      readonly frame: string;
      readonly receivedTimestampMs: number;
    }> = [];
    let now = 100;
    const session = new BinancePublicWebSocketSession({
      products: ["EURUSDC", "EURIUSDC", "USDCUSD"],
      maxFrameBytes: 1024,
      webSocketFactory: factory,
      now: () => now++,
      onOpen,
      onFrame: (frame, receivedTimestampMs) => {
        frames.push({ frame, receivedTimestampMs });
      }
    });

    session.start();
    const expectedUrl = createBinancePublicWebSocketUrl([
      "EURUSDC",
      "EURIUSDC",
      "USDCUSD"
    ]);
    expect(factory).toHaveBeenCalledWith(expectedUrl);
    expect(expectedUrl).toContain("eurusdc@depth@100ms");
    expect(expectedUrl).toContain("eurusdc@trade");
    expect(expectedUrl).not.toMatch(/key|signature|listenKey/iu);

    socket.emitOpen();
    expect(onOpen).toHaveBeenCalledOnce();
    socket.emitMessage('{"stream":"one","data":{"e":"future"}}');
    socket.emitMessage('{"stream":"two","data":{"e":"future"}}');
    await session.drain();
    expect(frames).toEqual([
      {
        frame: '{"stream":"one","data":{"e":"future"}}',
        receivedTimestampMs: 100
      },
      {
        frame: '{"stream":"two","data":{"e":"future"}}',
        receivedTimestampMs: 101
      }
    ]);
  });

  it("fails closed on oversized, binary, and processing failures", async () => {
    const oversizedSocket = new FakeWebSocket();
    const onFatal = vi.fn();
    const oversized = new BinancePublicWebSocketSession({
      products: ["EURUSDC"],
      maxFrameBytes: 3,
      webSocketFactory: () => oversizedSocket,
      onFrame: vi.fn(),
      onFatal
    });
    oversized.start();
    oversizedSocket.emitMessage("four");
    await expect(oversized.drain()).rejects.toThrow(/exceeded 3 bytes/u);
    expect(oversizedSocket.closes).toEqual([
      { code: 1011, reason: "collector_failure" }
    ]);
    expect(onFatal).toHaveBeenCalledOnce();

    const binarySocket = new FakeWebSocket();
    const binary = new BinancePublicWebSocketSession({
      products: ["EURUSDC"],
      maxFrameBytes: 100,
      webSocketFactory: () => binarySocket,
      onFrame: vi.fn()
    });
    binary.start();
    binarySocket.emitMessage(new Uint8Array([1]));
    await expect(binary.drain()).rejects.toThrow(/was not text/u);

    const callbackSocket = new FakeWebSocket();
    const callback = new BinancePublicWebSocketSession({
      products: ["EURUSDC"],
      maxFrameBytes: 100,
      webSocketFactory: () => callbackSocket,
      onFrame: () => {
        throw new Error("processor failed");
      }
    });
    callback.start();
    callbackSocket.emitMessage("{}");
    await expect(callback.drain()).rejects.toThrow(/processor failed/u);
  });

  it("reports closes and supports a targeted stop", () => {
    const socket = new FakeWebSocket();
    const onClose = vi.fn();
    const session = new BinancePublicWebSocketSession({
      products: ["EURUSDC"],
      maxFrameBytes: 1024,
      webSocketFactory: () => socket,
      onFrame: vi.fn(),
      onClose
    });
    session.start();
    session.stop();
    expect(socket.closes).toEqual([
      { code: 1000, reason: "collector_stop" }
    ]);

    const secondSocket = new FakeWebSocket();
    const second = new BinancePublicWebSocketSession({
      products: ["EURUSDC"],
      maxFrameBytes: 1024,
      webSocketFactory: () => secondSocket,
      onFrame: vi.fn(),
      onClose
    });
    second.start();
    secondSocket.emitClose(1006, "network");
    expect(second.started).toBe(false);
    expect(onClose).toHaveBeenCalledWith(1006, "network");
  });
});
