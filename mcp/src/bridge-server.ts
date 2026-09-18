import { createServer, type Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { BridgeError } from "./errors.js";
import {
  BRIDGE_STATUS_METHOD,
  DEFAULT_BRIDGE_PORT,
  PROTOCOL_VERSION,
  type BridgeMessage,
  type RpcMessage,
  type RpcResultMessage,
} from "./protocol.js";
import { RateLimiter } from "./rate-limit.js";
import { tokensEqual, extractToken } from "./security.js";

export interface BridgeServerOptions {
  token: string;
  port?: number;
  host?: string;
  actLimitPerMin?: number;
  rpcTimeoutMs?: number;
}

export type BridgeStatus = {
  paired: boolean;
  port: number;
  host: string;
  protocolVersion: string;
  lastEvent: {
    event: string;
    data?: unknown;
    at: number;
  } | null;
  mode?: "server" | "attach";
  controllers?: number;
};

type Pending = {
  resolve: (msg: RpcResultMessage) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** True when listen failed because the port is already bound. */
export function isEaddrInUse(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "EADDRINUSE"
  );
}

/**
 * Localhost-only WebSocket server. MCP holds the listener; the extension dials in.
 * Extra MCP processes (Claude Desktop Chat + Cowork double-spawn) attach as
 * role:controller peers instead of binding again.
 */
export class BridgeServer {
  readonly port: number;
  readonly host: string;
  private readonly token: string;
  private readonly rpcTimeoutMs: number;
  private readonly actLimiter: RateLimiter;
  private http: HttpServer | null = null;
  private wss: WebSocketServer | null = null;
  private extension: WebSocket | null = null;
  private readonly controllers = new Set<WebSocket>();
  private pending = new Map<string, Pending>();
  private rpcSeq = 0;
  paired = false;
  lastEvent: { event: string; data?: unknown; at: number } | null = null;

  constructor(opts: BridgeServerOptions) {
    if (!opts.token || opts.token.length < 64) {
      throw new Error(
        "ASKJEV_TOKEN must be a pairing token of at least 64 hex chars (32+ bytes)",
      );
    }
    this.token = opts.token;
    this.port = opts.port ?? DEFAULT_BRIDGE_PORT;
    this.host = opts.host ?? "127.0.0.1";
    this.rpcTimeoutMs = opts.rpcTimeoutMs ?? 45_000;
    this.actLimiter = new RateLimiter(opts.actLimitPerMin ?? 30, 60_000);
  }

  async listen(): Promise<void> {
    if (this.host !== "127.0.0.1" && this.host !== "localhost") {
      throw new Error("AskJev bridge must bind to 127.0.0.1 only");
    }
    const http = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("askjev-mcp bridge — connect via WebSocket\n");
    });
    this.http = http;
    this.wss = new WebSocketServer({ server: http });

    this.wss.on("connection", (ws, req) => {
      const remote = req.socket.remoteAddress || "";
      if (
        remote !== "127.0.0.1" &&
        remote !== "::1" &&
        remote !== "::ffff:127.0.0.1"
      ) {
        ws.close(1008, "localhost only");
        return;
      }
      ws.on("message", (raw) => this.onMessage(ws, raw.toString()));
      ws.on("close", () => {
        if (this.controllers.has(ws)) {
          this.controllers.delete(ws);
        }
        if (this.extension === ws) {
          this.extension = null;
          this.paired = false;
          this.failAllPending(
            new BridgeError("bridge_offline", "extension disconnected"),
          );
        }
      });
      ws.on("error", () => {
        /* ignore; close handler cleans up */
      });
    });

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        http.off("error", fail);
        this.wss?.off("error", fail);
        reject(err);
      };
      const ok = () => {
        if (settled) return;
        settled = true;
        http.off("error", fail);
        this.wss?.off("error", fail);
        // Persistent handlers so EADDRINUSE / late errors are never unhandled.
        http.on("error", (err) => {
          if (!isEaddrInUse(err)) {
            console.error("AskJev bridge http error:", err);
          }
        });
        this.wss!.on("error", (err) => {
          if (!isEaddrInUse(err)) {
            console.error("AskJev bridge wss error:", err);
          }
        });
        resolve();
      };
      http.on("error", fail);
      this.wss!.on("error", fail);
      http.listen(this.port, this.host, ok);
    });
  }

  async close(): Promise<void> {
    this.failAllPending(
      new BridgeError("bridge_offline", "bridge shutting down"),
    );
    for (const c of this.controllers) {
      try {
        c.close();
      } catch {
        /* ignore */
      }
    }
    this.controllers.clear();
    this.extension?.close();
    this.extension = null;
    this.paired = false;
    await new Promise<void>((resolve) => {
      this.wss?.close(() => resolve());
      if (!this.wss) resolve();
    });
    await new Promise<void>((resolve) => {
      this.http?.close(() => resolve());
      if (!this.http) resolve();
    });
  }

  getStatus(): BridgeStatus {
    return {
      paired: this.paired,
      port: this.port,
      host: this.host,
      protocolVersion: PROTOCOL_VERSION,
      lastEvent: this.lastEvent,
      mode: "server",
      controllers: this.controllers.size,
    };
  }

  /** Forward an RPC to the paired extension and await rpc_result. */
  async call(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    if (method === "act" && !this.actLimiter.try()) {
      throw new BridgeError("rate_limited", "act rate limit exceeded (30/min)");
    }
    if (!this.extension || this.extension.readyState !== WebSocket.OPEN) {
      throw new BridgeError(
        "bridge_offline",
        "AskJev extension is not connected — enable Agent Bridge in Options",
      );
    }
    if (!this.paired) {
      throw new BridgeError("not_paired", "extension has not completed hello");
    }

    const id = `rpc_${++this.rpcSeq}_${Date.now()}`;
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
      this.extension!.send(JSON.stringify(msg));
    });

    if (!result.ok) {
      const code = (result.error?.code || "internal") as BridgeError["code"];
      throw new BridgeError(code, result.error?.message || "rpc failed");
    }
    return result.result;
  }

  private onMessage(ws: WebSocket, raw: string): void {
    let msg: BridgeMessage;
    try {
      msg = JSON.parse(raw) as BridgeMessage;
    } catch {
      this.send(ws, {
        type: "error",
        code: "invalid_params",
        message: "invalid json",
      });
      return;
    }

    if (msg.type === "hello") {
      this.handleHello(ws, msg);
      return;
    }

    const token = extractToken(msg);
    if (!token || !tokensEqual(token, this.token)) {
      this.send(ws, {
        type: "error",
        code: "unauthorized",
        message: "invalid pairing token",
      });
      if (msg.type !== "ping") ws.close(1008, "unauthorized");
      return;
    }

    if (msg.type === "ping") {
      this.send(ws, { type: "pong" });
      return;
    }

    if (msg.type === "rpc_result") {
      const p = this.pending.get(msg.id);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(msg.id);
        p.resolve(msg);
      }
      return;
    }

    if (msg.type === "event") {
      this.lastEvent = { event: msg.event, data: msg.data, at: Date.now() };
      return;
    }

    if (msg.type === "rpc") {
      if (this.controllers.has(ws)) {
        void this.handleControllerRpc(ws, msg);
        return;
      }
      this.send(ws, {
        type: "rpc_result",
        id: msg.id,
        ok: false,
        error: {
          code: "unauthorized",
          message: "extension cannot call mcp rpc",
        },
      });
    }
  }

  private async handleControllerRpc(
    ws: WebSocket,
    msg: RpcMessage,
  ): Promise<void> {
    try {
      if (msg.method === BRIDGE_STATUS_METHOD) {
        this.send(ws, {
          type: "rpc_result",
          id: msg.id,
          ok: true,
          result: this.getStatus(),
        });
        return;
      }
      const result = await this.call(msg.method, msg.params);
      this.send(ws, {
        type: "rpc_result",
        id: msg.id,
        ok: true,
        result,
      });
    } catch (err) {
      const code =
        err instanceof BridgeError ? err.code : ("internal" as const);
      const message = err instanceof Error ? err.message : String(err);
      this.send(ws, {
        type: "rpc_result",
        id: msg.id,
        ok: false,
        error: { code, message },
      });
    }
  }

  private handleHello(
    ws: WebSocket,
    msg: Extract<BridgeMessage, { type: "hello" }>,
  ): void {
    if (!tokensEqual(msg.token, this.token)) {
      this.send(ws, {
        type: "error",
        code: "unauthorized",
        message: "invalid pairing token",
      });
      ws.close(1008, "unauthorized");
      return;
    }

    if (msg.role === "controller") {
      this.controllers.add(ws);
      this.send(ws, {
        type: "hello",
        token: this.token,
        role: "mcp",
        version: PROTOCOL_VERSION,
      });
      return;
    }

    if (msg.role !== "extension") {
      this.send(ws, {
        type: "error",
        code: "unauthorized",
        message: "expected role extension or controller",
      });
      ws.close(1008, "unauthorized");
      return;
    }

    if (this.extension && this.extension !== ws) {
      try {
        this.extension.close(1000, "replaced");
      } catch {
        /* ignore */
      }
    }
    this.extension = ws;
    this.paired = true;
    this.send(ws, {
      type: "hello",
      token: this.token,
      role: "mcp",
      version: PROTOCOL_VERSION,
    });
  }

  private send(ws: WebSocket, msg: BridgeMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
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
