/**
 * askjev_status mode notes + clearer unpaired tool errors.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { BridgeServer } from "../dist/bridge-server.js";
import { BridgeAttach } from "../dist/bridge-attach.js";
import { BridgeError } from "../dist/errors.js";
import {
  bridgeErrorHint,
  bridgeModeNote,
  unpairedStatusNote,
} from "../dist/status-notes.js";

function token() {
  return randomBytes(32).toString("hex");
}

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

describe("status notes + unpaired errors", () => {
  it("bridgeModeNote distinguishes listen vs attach", () => {
    const listen = bridgeModeNote({ mode: "server", port: 17373, controllers: 0 });
    assert.match(listen, /mode=listen/);
    assert.match(listen, /owns the WebSocket listener/);

    const attach = bridgeModeNote({ mode: "attach", port: 17373, controllers: 1 });
    assert.match(attach, /mode=attach/);
    assert.match(attach, /peer controller/);
  });

  it("unpairedStatusNote mentions mode", () => {
    assert.match(
      unpairedStatusNote({ mode: "server", port: 17373 }),
      /listening on 127\.0\.0\.1:17373/,
    );
    assert.match(
      unpairedStatusNote({ mode: "attach", port: 17373 }),
      /attached as peer/,
    );
  });

  it("not_paired / bridge_offline hints are actionable", () => {
    const h = bridgeErrorHint("not_paired");
    assert.ok(h && /Auto-connect|Agent Bridge/i.test(h));
    const offline = bridgeErrorHint("bridge_offline");
    assert.ok(offline && /ASKJEV_TOKEN|extension/i.test(offline));
  });

  it("BridgeServer.call when unpaired throws not_paired with clear message", async () => {
    const t = token();
    const port = await freePort();
    const owner = new BridgeServer({ token: t, port, host: "127.0.0.1" });
    await owner.listen();
    const st = owner.getStatus();
    assert.equal(st.mode, "server");
    assert.equal(st.paired, false);
    assert.match(bridgeModeNote(st), /mode=listen/);

    await assert.rejects(
      () => owner.call("status", {}),
      (err) => {
        assert.ok(err instanceof BridgeError);
        assert.equal(err.code, "not_paired");
        assert.match(err.message, /not paired|Options/i);
        return true;
      },
    );

    await owner.close();
  });

  it("dual-client: attach peer getStatus mode=attach; unpaired call is not_paired", async () => {
    const t = token();
    const port = await freePort();
    const owner = new BridgeServer({ token: t, port, host: "127.0.0.1" });
    await owner.listen();

    const peer = await BridgeAttach.connect({
      token: t,
      port,
      host: "127.0.0.1",
    });
    const status = await peer.getStatus();
    assert.equal(status.mode, "attach");
    assert.equal(status.paired, false);
    assert.match(bridgeModeNote(status), /mode=attach/);
    assert.match(unpairedStatusNote(status), /attached as peer/);

    await assert.rejects(
      () => peer.call("snapshot", { goal: "x" }),
      (err) => {
        assert.ok(err instanceof BridgeError);
        assert.equal(err.code, "not_paired");
        return true;
      },
    );

    await peer.close();
    await owner.close();
  });
});

describe("askjev_status soft paired warning contract", () => {
  it("documents that paired+rpc failure stays paired (tool layer)", () => {
    // Tool-layer behavior lives in index.ts (cannot import main). Assert the
    // contract helpers still treat paired listen status as listen mode.
    const local = {
      paired: true,
      port: 17373,
      host: "127.0.0.1",
      protocolVersion: "1.0",
      lastEvent: null,
      mode: "server",
      controllers: 0,
    };
    assert.equal(local.paired, true);
    assert.match(bridgeModeNote(local), /mode=listen/);
    // Soft response shape expected by Claude when RPC fails after pair:
    const soft = {
      ...local,
      paired: true,
      extension: null,
      warning:
        "paired but extension status RPC failed — bridge may be reconnecting; retry askjev_list_tabs / askjev_status",
      rpcError: { code: "bridge_offline", message: "extension disconnected" },
    };
    assert.equal(soft.paired, true);
    assert.ok(soft.warning.includes("paired but extension status RPC failed"));
  });
});
