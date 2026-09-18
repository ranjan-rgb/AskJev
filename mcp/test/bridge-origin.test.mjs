import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WebSocket } from "ws";
import {
  BridgeServer,
  HANDSHAKE_TIMEOUT_MS,
  isAllowedOrigin,
} from "../dist/bridge-server.js";

const TOKEN = "a".repeat(64);

/** Bind on an ephemeral-ish port so parallel runs do not collide. */
function testPort() {
  return 17600 + Math.floor(Math.random() * 300);
}

async function withServer(fn) {
  const server = new BridgeServer({ token: TOKEN, port: testPort() });
  await server.listen();
  try {
    return await fn(server);
  } finally {
    await server.close();
  }
}

function connect(port, headers) {
  return new WebSocket(`ws://127.0.0.1:${port}`, { headers });
}

function closeCode(ws) {
  return new Promise((resolve) => {
    ws.on("close", (code, reason) => resolve({ code, reason: String(reason) }));
    ws.on("error", () => {});
  });
}

describe("isAllowedOrigin", () => {
  it("allows a Node peer that sends no Origin", () => {
    assert.equal(isAllowedOrigin(undefined), true);
    assert.equal(isAllowedOrigin(""), true);
  });

  it("allows browser extension origins", () => {
    assert.equal(isAllowedOrigin("chrome-extension://abcdef"), true);
    assert.equal(isAllowedOrigin("moz-extension://abcdef"), true);
  });

  it("rejects ordinary web pages", () => {
    // WebSockets skip CORS, so any visited page can dial localhost.
    assert.equal(isAllowedOrigin("https://evil.example"), false);
    assert.equal(isAllowedOrigin("http://localhost:3000"), false);
    assert.equal(isAllowedOrigin("https://mail.google.com"), false);
  });

  it("is not fooled by an extension scheme appearing mid-string", () => {
    assert.equal(
      isAllowedOrigin("https://evil.example/chrome-extension://x"),
      false,
    );
  });
});

describe("bridge connection policy", () => {
  it("closes a web-page origin before it can try a token", async () => {
    await withServer(async (server) => {
      const ws = connect(server.port, { Origin: "https://evil.example" });
      const { code, reason } = await closeCode(ws);
      assert.equal(code, 1008);
      assert.match(reason, /origin/i);
      assert.equal(server.paired, false);
    });
  });

  it("accepts an extension origin and pairs on hello", async () => {
    await withServer(async (server) => {
      const ws = connect(server.port, { Origin: "chrome-extension://abc" });
      await new Promise((r) => ws.on("open", r));
      ws.send(
        JSON.stringify({
          type: "hello",
          token: TOKEN,
          role: "extension",
          version: "1.0",
        }),
      );
      await new Promise((r) => ws.on("message", r));
      assert.equal(server.paired, true);
      ws.close();
    });
  });

  it("exposes a bounded handshake window", () => {
    assert.equal(typeof HANDSHAKE_TIMEOUT_MS, "number");
    assert.ok(
      HANDSHAKE_TIMEOUT_MS > 0 && HANDSHAKE_TIMEOUT_MS <= 30_000,
      "silent sockets must be reaped promptly",
    );
  });
});
