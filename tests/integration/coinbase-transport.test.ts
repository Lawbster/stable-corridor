import { describe, expect, it, vi } from "vitest";

import {
  COINBASE_ADVANCED_PUBLIC_WEBSOCKET_URL
} from "../../src/venues/coinbase/constants.js";
import {
  CoinbasePublicWebSocketSession,
  type CoinbaseWebSocketLike
} from "../../src/venues/coinbase/transport.js";

class FakeWebSocket implements CoinbaseWebSocketLike {
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

describe("Coinbase public WebSocket session", () => {
  it("subscribes only to the four public channels", async () => {
    const socket = new FakeWebSocket();
    const factory = vi.fn(() => socket);
    const frames: Array<{
      readonly frame: string;
      readonly receivedTimestampMs: number;
    }> = [];
    let now = 100;
    const session = new CoinbasePublicWebSocketSession({
      products: ["EURC-USDC", "USDC-EUR"],
      maxFrameBytes: 1024,
      webSocketFactory: factory,
      now: () => now++,
      onFrame: (frame, receivedTimestampMs) => {
        frames.push({ frame, receivedTimestampMs });
      }
    });

    session.start();
    expect(factory).toHaveBeenCalledWith(
      COINBASE_ADVANCED_PUBLIC_WEBSOCKET_URL
    );
    socket.emitOpen();

    expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
      {
        type: "subscribe",
        product_ids: ["EURC-USDC", "USDC-EUR"],
        channel: "level2"
      },
      {
        type: "subscribe",
        product_ids: ["EURC-USDC", "USDC-EUR"],
        channel: "market_trades"
      },
      {
        type: "subscribe",
        product_ids: ["EURC-USDC", "USDC-EUR"],
        channel: "status"
      },
      {
        type: "subscribe",
        product_ids: ["EURC-USDC", "USDC-EUR"],
        channel: "heartbeats"
      }
    ]);
    expect(socket.sent.join("")).not.toMatch(/jwt|key|signature/iu);

    socket.emitMessage('{"sequence_num":0}');
    socket.emitMessage('{"sequence_num":1}');
    await session.drain();
    expect(frames).toEqual([
      { frame: '{"sequence_num":0}', receivedTimestampMs: 100 },
      { frame: '{"sequence_num":1}', receivedTimestampMs: 101 }
    ]);
  });

  it("fails closed on oversized or non-text frames", async () => {
    const oversizedSocket = new FakeWebSocket();
    const oversizedFatal = vi.fn();
    const oversized = new CoinbasePublicWebSocketSession({
      products: ["EURC-USDC"],
      maxFrameBytes: 3,
      webSocketFactory: () => oversizedSocket,
      onFrame: vi.fn(),
      onFatal: oversizedFatal
    });
    oversized.start();
    oversizedSocket.emitMessage("four");
    await expect(oversized.drain()).rejects.toThrow(/exceeded 3 bytes/u);
    expect(oversizedSocket.closes).toEqual([
      { code: 4000, reason: "collector_failure" }
    ]);
    expect(oversizedFatal).toHaveBeenCalledOnce();

    const binarySocket = new FakeWebSocket();
    const binary = new CoinbasePublicWebSocketSession({
      products: ["EURC-USDC"],
      maxFrameBytes: 10,
      webSocketFactory: () => binarySocket,
      onFrame: vi.fn()
    });
    binary.start();
    binarySocket.emitMessage(new Uint8Array([1, 2]));
    await expect(binary.drain()).rejects.toThrow(/was not text/u);
  });

  it("reports close state and supports a targeted stop", () => {
    const socket = new FakeWebSocket();
    const onClose = vi.fn();
    const session = new CoinbasePublicWebSocketSession({
      products: ["EURC-USDC"],
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
    const second = new CoinbasePublicWebSocketSession({
      products: ["EURC-USDC"],
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
