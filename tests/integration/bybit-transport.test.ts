import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BYBIT_PUBLIC_SPOT_WEBSOCKET_URL,
  createBybitSubscriptionMessage
} from "../../src/venues/bybit/constants.js";
import {
  BybitPublicWebSocketSession,
  type BybitWebSocketLike
} from "../../src/venues/bybit/transport.js";

class FakeWebSocket implements BybitWebSocketLike {
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
  readonly sent: string[] = [];
  readonly closes: Array<{
    readonly code: number | undefined;
    readonly reason: string | undefined;
  }> = [];

  send(data: string): void {
    this.sent.push(data);
  }

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

afterEach(() => {
  vi.useRealTimers();
});

describe("Bybit public WebSocket session", () => {
  it("uses the fixed public spot endpoint, approved topics, and heartbeat", () => {
    vi.useFakeTimers();
    const socket = new FakeWebSocket();
    const factory = vi.fn(() => socket);
    const onOpen = vi.fn();
    const session = new BybitPublicWebSocketSession({
      products: ["USDTEUR", "USDCEUR", "USDCUSDT"],
      maxFrameBytes: 1024,
      pingIntervalMs: 20_000,
      webSocketFactory: factory,
      onOpen,
      onFrame: vi.fn()
    });

    session.start();
    expect(factory).toHaveBeenCalledWith(
      BYBIT_PUBLIC_SPOT_WEBSOCKET_URL
    );
    expect(BYBIT_PUBLIC_SPOT_WEBSOCKET_URL).toContain("/v5/public/spot");
    socket.emitOpen();
    expect(onOpen).toHaveBeenCalledOnce();
    expect(JSON.parse(socket.sent[0]!)).toEqual(
      createBybitSubscriptionMessage([
        "USDTEUR",
        "USDCEUR",
        "USDCUSDT"
      ])
    );
    expect(socket.sent[0]).not.toMatch(/key|signature|authorization/iu);

    vi.advanceTimersByTime(20_000);
    expect(JSON.parse(socket.sent[1]!)).toEqual({ op: "ping" });
    session.stop();
    vi.advanceTimersByTime(60_000);
    expect(socket.sent).toHaveLength(2);
  });

  it("serializes text frames with receive timestamps", async () => {
    const socket = new FakeWebSocket();
    const frames: Array<{
      readonly frame: string;
      readonly receivedTimestampMs: number;
    }> = [];
    let now = 100;
    const session = new BybitPublicWebSocketSession({
      products: ["USDCUSDT"],
      maxFrameBytes: 1024,
      pingIntervalMs: 20_000,
      webSocketFactory: () => socket,
      now: () => now++,
      onFrame: async (frame, receivedTimestampMs) => {
        await Promise.resolve();
        frames.push({ frame, receivedTimestampMs });
      }
    });

    session.start();
    socket.emitMessage('{"topic":"one"}');
    socket.emitMessage('{"topic":"two"}');
    await session.drain();
    expect(frames).toEqual([
      { frame: '{"topic":"one"}', receivedTimestampMs: 100 },
      { frame: '{"topic":"two"}', receivedTimestampMs: 101 }
    ]);
    session.stop();
  });

  it("fails closed on oversized, binary, processing, and socket errors", async () => {
    const oversizedSocket = new FakeWebSocket();
    const oversized = new BybitPublicWebSocketSession({
      products: ["USDCUSDT"],
      maxFrameBytes: 3,
      pingIntervalMs: 20_000,
      webSocketFactory: () => oversizedSocket,
      onFrame: vi.fn()
    });
    oversized.start();
    oversizedSocket.emitMessage("four");
    await expect(oversized.drain()).rejects.toThrow(/exceeded 3 bytes/u);
    expect(oversizedSocket.closes).toEqual([
      { code: 4000, reason: "collector_failure" }
    ]);

    const binarySocket = new FakeWebSocket();
    const binary = new BybitPublicWebSocketSession({
      products: ["USDCUSDT"],
      maxFrameBytes: 100,
      pingIntervalMs: 20_000,
      webSocketFactory: () => binarySocket,
      onFrame: vi.fn()
    });
    binary.start();
    binarySocket.emitMessage(new Uint8Array([1]));
    await expect(binary.drain()).rejects.toThrow(/was not text/u);

    const callbackSocket = new FakeWebSocket();
    const callback = new BybitPublicWebSocketSession({
      products: ["USDCUSDT"],
      maxFrameBytes: 100,
      pingIntervalMs: 20_000,
      webSocketFactory: () => callbackSocket,
      onFrame: () => {
        throw new Error("processor failed");
      }
    });
    callback.start();
    callbackSocket.emitMessage("{}");
    await expect(callback.drain()).rejects.toThrow(/processor failed/u);

    const errorSocket = new FakeWebSocket();
    const errored = new BybitPublicWebSocketSession({
      products: ["USDCUSDT"],
      maxFrameBytes: 100,
      pingIntervalMs: 20_000,
      webSocketFactory: () => errorSocket,
      onFrame: vi.fn()
    });
    errored.start();
    errorSocket.onerror?.(new Error("network error"));
    await expect(errored.drain()).rejects.toThrow(/network error/u);
  });

  it("reports closes and supports a targeted stop", () => {
    const firstSocket = new FakeWebSocket();
    const onClose = vi.fn();
    const session = new BybitPublicWebSocketSession({
      products: ["USDCUSDT"],
      maxFrameBytes: 1024,
      pingIntervalMs: 20_000,
      webSocketFactory: () => firstSocket,
      onFrame: vi.fn(),
      onClose
    });
    session.start();
    session.stop();
    expect(firstSocket.closes).toEqual([
      { code: 1000, reason: "collector_stop" }
    ]);

    const secondSocket = new FakeWebSocket();
    const second = new BybitPublicWebSocketSession({
      products: ["USDCUSDT"],
      maxFrameBytes: 1024,
      pingIntervalMs: 20_000,
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
