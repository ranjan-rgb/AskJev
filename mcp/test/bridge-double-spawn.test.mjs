/**
 * Claude Desktop double-spawn: second BridgeServer.listen on a busy port
 * must attach via BridgeAttach (not crash / unhandled EADDRINUSE).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  BridgeServer,
  isEaddrInUse,
} from "../dist/bridge-server.js";
import { BridgeAttach } from "../dist/bridge-attach.js";

function token() {
  return randomBytes(32).toString("hex");
}

/** Pick an free high port by binding then closing. */
async function freePort() {
  const { createServer } = await import("node:http");
  return await new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      s.close((err) => (err ? reject(err) : resolve(port)));
    });
    s.on("error", reject);
  });
}

describe("Claude Desktop double-spawn / bridge attach", () => {
  it("isEaddrInUse detects EADDRINUSE", () => {
    assert.equal(isEaddrInUse({ code: "EADDRINUSE" }), true);
    assert.equal(isEaddrInUse(new Error("nope")), false);
    assert.equal(isEaddrInUse(null), false);
  });

  it("second listen hits EADDRINUSE; BridgeAttach stays alive", async () => {
    const t = token();
    const port = await freePort();
    const owner = new BridgeServer({ token: t, port, host: "127.0.0.1" });
    await owner.listen();

    const second = new BridgeServer({ token: t, port, host: "127.0.0.1" });
    let listenErr;
    try {
      await second.listen();
    } catch (err) {
      listenErr = err;
    }
    assert.ok(listenErr, "second listen must fail");
    assert.equal(isEaddrInUse(listenErr), true, "error must be EADDRINUSE");

    // Attach path — peer must connect and answer __bridge_status
    const peer = await BridgeAttach.connect({
      token: t,
      port,
      host: "127.0.0.1",
    });
    const status = await peer.getStatus();
    assert.equal(status.port, port);
    assert.equal(status.mode, "attach");
    assert.equal(status.paired, false);
    assert.ok(
      typeof status.controllers === "number" && status.controllers >= 1,
      "owner should report at least one controller",
    );

    await peer.close();
    await owner.close();
  });

  it("openBridge-style: EADDRINUSE → attach without process crash", async () => {
    const t = token();
    const port = await freePort();
    const owner = new BridgeServer({ token: t, port, host: "127.0.0.1" });
    await owner.listen();

    const candidate = new BridgeServer({ token: t, port, host: "127.0.0.1" });
    let bridge;
    try {
      await candidate.listen();
      bridge = candidate;
    } catch (err) {
      assert.equal(isEaddrInUse(err), true);
      try {
        await candidate.close();
      } catch {
        /* ignore */
      }
      bridge = await BridgeAttach.connect({ token: t, port, host: "127.0.0.1" });
    }

    assert.ok(bridge);
    const st = await Promise.resolve(bridge.getStatus());
    assert.equal(st.port, port);

    await bridge.close();
    await owner.close();
  });
});
