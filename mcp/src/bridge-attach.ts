import { WebSocket } from "ws";
import { BridgeError } from "./errors.js";
import type { BridgeStatus } from "./bridge-server.js";
import {
  BRIDGE_STATUS_METHOD,
  DEFAULT_BRIDGE_PORT,
  PROTOCOL_VERSION,
  type BridgeMessage,
  type RpcResultMessage,
} from "./protocol.js";

export interface BridgeAttachOptions {
  token: string;
  port?: number;
  host?: string;
  rpcTimeoutMs?: number;
  /** Handshake timeout when connecting to the owner bridge. */
  connectTimeoutMs?: number;
}

type Pending = {
  resolve: (msg: RpcResultMessage) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Peer MCP client: attaches to an existing BridgeServer over WS as role:controller.
 * Same tool surface as BridgeServer (getStatus / call / close) for Claude Desktop
 * double-spawn when 127.0.0.1:PORT is already bound.
 */
export class BridgeAttach {
  readonly port: number;
  readonly host: string;
  private readonly token: string;
  private readonly rpcTimeoutMs: number;
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private rpcSeq = 0;
  private lastStatus: BridgeStatus | null = null;

  private constructor(opts: {
    token: string;
    port: number;
    host: string;
    rpcTimeoutMs: number;
    ws: WebSocket;
  }) {
    this.token = opts.token;
    this.port = opts.port;
    this.host = opts.host;
    this.rpcTimeoutMs = opts.rpcTimeoutMs;
    this.ws = opts.ws;
    this.ws.on("message", (raw) => this.onMessage(raw.toString()));
    this.ws.on("close", () => {
      this.failAllPending(
        new BridgeError("bridge_offline", "owner bridge disconnected"),
      );
      this.ws = null;
    });
    this.ws.on("error", () => {
      /* close handler cleans up */
    });
  }

  static async connect(opts: BridgeAttachOptions): Promise<BridgeAttach> {
    if (!opts.token || opts.token.length < 64) {
      throw new Error(
        "ASKJEV_TOKEN must be a pairing token of at least 64 hex chars (32+ bytes)",
      );
    }
    const port = opts.port ?? DEFAULT_BRIDGE_PORT;
    const host = opts.host ?? "127.0.0.1";
    if (host !== "127.0.0.1" && host !== "localhost") {
      throw new Error("AskJev bridge attach must use 127.0.0.1 only");
    }
    const rpcTimeoutMs = opts.rpcTimeoutMs ?? 45_000;
    const connectTimeoutMs = opts.connectTimeoutMs ?? 10_000;
    const url = `ws://${host}:${port}`;

    const ws = await new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(url);
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          socket.close();
        } catch {
          /* ignore */
        }
        reject(
          new BridgeError(
            "timeout",
            `attach connect timed out (${connectTimeoutMs}ms)`,
          ),
        );
      }, connectTimeoutMs);

      socket.once("open", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(socket);
      });
      socket.once("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
    });

    const attach = new BridgeAttach({
      token: opts.token,
      port,
      host,
      rpcTimeoutMs,
      ws,
    });

    await attach.handshake();
    return attach;
  }

  private handshake(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new BridgeError("timeout", "attach hello timed out"));
      }, this.rpcTimeoutMs);

      const onMessage = (raw: WebSocket.RawData) => {
        let msg: BridgeMessage;
        try {
          msg = JSON.parse(raw.toString()) as BridgeMessage;
        } catch {
          return;
        }
        if (msg.type === "hello" && msg.role === "mcp") {
          cleanup();
          resolve();
          return;
        }
        if (msg.type === "error") {
          cleanup();
          reject(
            new BridgeError(
              (msg.code as BridgeError["code"]) || "unauthorized",
              msg.message,
            ),
          );
        }
      };

      const onClose = () => {
        cleanup();
        reject(new BridgeError("bridge_offline", "closed during hello"));
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.ws?.off("message", onMessage);
        this.ws?.off("close", onClose);
      };

      this.ws!.on("message", onMessage);
      this.ws!.once("close", onClose);
      this.ws!.send(
        JSON.stringify({
          type: "hello",
          token: this.token,
          role: "controller",
          version: PROTOCOL_VERSION,
        }),
      );
    });
  }

  async getStatus(): Promise<BridgeStatus> {
    const result = (await this.call(BRIDGE_STATUS_METHOD, {})) as BridgeStatus;
    this.lastStatus = {
      ...result,
      mode: "attach",
    };
    return this.lastStatus;
  }

  async call(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new BridgeError(
        "bridge_offline",
        "not connected to owner bridge",
      );
    }

    const id = `ctl_${++this.rpcSeq}_${Date.now()}`;
    const msg = {
      type: "rpc" as const,
      id,
      token: this.token,
      method,
      params: params || {},
    };

    const result = await new Promise<RpcResultMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BridgeError("timeout", `rpc ${method} timed out`));
      }, this.rpcTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws!.send(JSON.stringify(msg));
    });

    if (!result.ok) {
      const code = (result.error?.code || "internal") as BridgeError["code"];
      throw new BridgeError(code, result.error?.message || "rpc failed");
    }
    return result.result;
  }

  async close(): Promise<void> {
    this.failAllPending(
      new BridgeError("bridge_offline", "attach shutting down"),
    );
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    await new Promise<void>((resolve) => {
      if (ws.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }
      ws.once("close", () => resolve());
      try {
        ws.close();
      } catch {
        resolve();
      }
    });
  }

  private onMessage(raw: string): void {
    let msg: BridgeMessage;
    try {
      msg = JSON.parse(raw) as BridgeMessage;
    } catch {
      return;
    }
    if (msg.type === "rpc_result") {
      const p = this.pending.get(msg.id);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(msg.id);
        p.resolve(msg);
      }
    }
  }

  private failAllPending(err: Error): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
      this.pending.delete(id);
    }
  }
}
