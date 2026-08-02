import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { describe, expect, it } from "vitest";

import {
  PUBLIC_FEED_FAILURE_CLOSE_CODE,
  PUBLIC_FEED_RECOVERY_CLOSE_CODE
} from "../../src/venues/websocket-close.js";

describe("public WebSocket application close codes", () => {
  it("uses distinct private-range codes for failure and recovery", () => {
    expect(PUBLIC_FEED_FAILURE_CLOSE_CODE).toBe(4000);
    expect(PUBLIC_FEED_RECOVERY_CLOSE_CODE).toBe(4001);
    expect(PUBLIC_FEED_FAILURE_CLOSE_CODE).toBeGreaterThanOrEqual(3000);
    expect(PUBLIC_FEED_RECOVERY_CLOSE_CODE).toBeLessThanOrEqual(4999);
  });

  it("is accepted by the Node.js built-in WebSocket implementation", async () => {
    const server = createServer();
    let destroyPeer: (() => void) | undefined;
    server.on("upgrade", (request, socket) => {
      const key = request.headers["sec-websocket-key"];
      if (typeof key !== "string") {
        socket.destroy();
        return;
      }
      const accept = createHash("sha1")
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest("base64");
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
      );
      destroyPeer = () => socket.destroy();
    });
    await new Promise<void>((resolveListen) => {
      server.listen(0, "127.0.0.1", resolveListen);
    });
    const address = server.address() as AddressInfo;
    const client = new WebSocket(`ws://127.0.0.1:${address.port}`);
    await new Promise<void>((resolveOpen, rejectOpen) => {
      client.addEventListener("open", () => resolveOpen(), { once: true });
      client.addEventListener(
        "error",
        () => rejectOpen(new Error("Local WebSocket did not open")),
        { once: true }
      );
    });

    expect(() => client.close(1011, "collector_failure")).toThrow(
      /invalid code/iu
    );
    expect(() =>
      client.close(
        PUBLIC_FEED_RECOVERY_CLOSE_CODE,
        "feed_recovery_required"
      )
    ).not.toThrow();

    destroyPeer?.();
    await new Promise<void>((resolveClose) => {
      server.close(() => resolveClose());
    });
  });
});
