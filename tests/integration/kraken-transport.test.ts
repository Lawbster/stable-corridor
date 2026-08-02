import { describe, expect, it, vi } from "vitest";

import {
  createKrakenSubscriptionMessages,
  KRAKEN_PUBLIC_PRODUCTS,
  KRAKEN_PUBLIC_WEBSOCKET_URL
} from "../../src/venues/kraken/constants.js";
import {
  KrakenPublicWebSocketSession,
  type KrakenWebSocketLike
} from "../../src/venues/kraken/transport.js";

class FakeWebSocket implements KrakenWebSocketLike {
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

describe("Kraken public WebSocket session", () => {
  it("uses only the fixed v2 public endpoint and approved subscriptions", () => {
    const socket = new FakeWebSocket();
    const factory = vi.fn(() => socket);
    const onOpen = vi.fn();
    const session = new KrakenPublicWebSocketSession({
      products: KRAKEN_PUBLIC_PRODUCTS,
      maxFrameBytes: 1024,
      webSocketFactory: factory,
      onOpen,
      onFrame: vi.fn()
    });
    session.start();
    expect(factory).toHaveBeenCalledWith(KRAKEN_PUBLIC_WEBSOCKET_URL);
    socket.emitOpen();
    expect(onOpen).toHaveBeenCalledOnce();
    expect(socket.sent.map((frame) => JSON.parse(frame))).toEqual(
      createKrakenSubscriptionMessages(KRAKEN_PUBLIC_PRODUCTS)
    );
    expect(socket.sent.join("")).not.toMatch(
      /token|api.?key|signature|auth/iu
    );
  });

  it("serializes text frames and receive timestamps", async () => {
    const socket = new FakeWebSocket();
    const frames: Array<{
      readonly frame: string;
      readonly receivedTimestampMs: number;
    }> = [];
    let now = 100;
    const session = new KrakenPublicWebSocketSession({
      products: ["USDC/USD"],
      maxFrameBytes: 1024,
      webSocketFactory: () => socket,
      now: () => now++,
      onFrame: async (frame, receivedTimestampMs) => {
        await Promise.resolve();
        frames.push({ frame, receivedTimestampMs });
      }
    });
    session.start();
    socket.emitMessage('{"channel":"heartbeat"}');
    socket.emitMessage('{"channel":"heartbeat"}');
    await session.drain();
    expect(frames).toEqual([
      { frame: '{"channel":"heartbeat"}', receivedTimestampMs: 100 },
      { frame: '{"channel":"heartbeat"}', receivedTimestampMs: 101 }
    ]);
  });

  it("fails closed on oversized, binary, callback, and socket errors", async () => {
    const oversizedSocket = new FakeWebSocket();
    const oversized = new KrakenPublicWebSocketSession({
      products: ["USDC/USD"],
      maxFrameBytes: 3,
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
    const binary = new KrakenPublicWebSocketSession({
      products: ["USDC/USD"],
      maxFrameBytes: 100,
      webSocketFactory: () => binarySocket,
      onFrame: vi.fn()
    });
    binary.start();
    binarySocket.emitMessage(new Uint8Array([1]));
    await expect(binary.drain()).rejects.toThrow(/was not text/u);

    const callbackSocket = new FakeWebSocket();
    const callback = new KrakenPublicWebSocketSession({
      products: ["USDC/USD"],
      maxFrameBytes: 100,
      webSocketFactory: () => callbackSocket,
      onFrame: () => {
        throw new Error("processor failed");
      }
    });
    callback.start();
    callbackSocket.emitMessage("{}");
    await expect(callback.drain()).rejects.toThrow(/processor failed/u);

    const errorSocket = new FakeWebSocket();
    const errored = new KrakenPublicWebSocketSession({
      products: ["USDC/USD"],
      maxFrameBytes: 100,
      webSocketFactory: () => errorSocket,
      onFrame: vi.fn()
    });
    errored.start();
    errorSocket.onerror?.(new Error("network error"));
    await expect(errored.drain()).rejects.toThrow(/network error/u);
  });

  it("reports closes and supports targeted stop", () => {
    const socket = new FakeWebSocket();
    const onClose = vi.fn();
    const session = new KrakenPublicWebSocketSession({
      products: ["USDC/USD"],
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
    const second = new KrakenPublicWebSocketSession({
      products: ["USDC/USD"],
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
