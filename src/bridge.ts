/**
 * Extension-side agent bridge client.
 * Dials ws://127.0.0.1:<port> when bridgeEnabled; MCP server is the listener.
 */
import type { AskJevSettings } from "./defaults.js";
import type { DomAction } from "./dom.js";
import { callJev } from "./jev.js";

export const BRIDGE_PROTOCOL_VERSION = "1.0";

export type BridgeConnectionState =
  | "disabled"
  | "connecting"
  | "connected"
  | "paired"
  | "error"
  | "backoff";

export interface BridgeStatusSnapshot {
  state: BridgeConnectionState;
  detail: string;
  lastError?: string;
  reconnectAttempt: number;
}

type RpcHandler = (
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

function tokensEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export class AgentBridgeClient {
  private ws: WebSocket | null = null;
  private settings: AskJevSettings | null = null;
  private handleRpc: RpcHandler;
  private state: BridgeConnectionState = "disabled";
  private detail = "bridge off";
  private lastError?: string;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = true;
  private onStatus?: (s: BridgeStatusSnapshot) => void;

  constructor(handleRpc: RpcHandler, onStatus?: (s: BridgeStatusSnapshot) => void) {
    this.handleRpc = handleRpc;
    this.onStatus = onStatus;
  }

  getSnapshot(): BridgeStatusSnapshot {
    return {
      state: this.state,
      detail: this.detail,
      lastError: this.lastError,
      reconnectAttempt: this.reconnectAttempt,
    };
  }

  /** Apply latest settings; start/stop/reconnect as needed. */
  sync(settings: AskJevSettings): void {
    const prev = this.settings;
    this.settings = settings;
    if (!settings.bridgeEnabled || !settings.bridgeToken) {
      this.stop();
      this.setState("disabled", settings.bridgeEnabled ? "generate a pairing token" : "bridge off");
      return;
    }
    const portChanged =
      prev &&
      (prev.bridgePort !== settings.bridgePort ||
        prev.bridgeToken !== settings.bridgeToken);
    if (this.stopped || portChanged || this.state === "disabled" || this.state === "error") {
      this.start();
    }
  }

  start(): void {
    this.stopped = false;
    this.clearReconnect();
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearReconnect();
    this.clearPing();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
  }

  private connect(): void {
    if (this.stopped || !this.settings?.bridgeEnabled || !this.settings.bridgeToken) {
      return;
    }
    const port = this.settings.bridgePort || 17373;
    const url = `ws://127.0.0.1:${port}`;
    this.setState("connecting", `dialing ${url}`);
    try {
      if (this.ws) {
        try {
          this.ws.close();
        } catch {
          /* ignore */
        }
      }
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.addEventListener("open", () => {
        this.reconnectAttempt = 0;
        this.setState("connected", "sending hello");
        ws.send(
          JSON.stringify({
            type: "hello",
            token: this.settings!.bridgeToken,
            role: "extension",
            version: BRIDGE_PROTOCOL_VERSION,
          }),
        );
        this.startPing();
      });
      ws.addEventListener("message", (ev) => {
        void this.onMessage(String(ev.data || ""));
      });
      ws.addEventListener("close", () => {
        this.clearPing();
        this.ws = null;
        if (!this.stopped) this.scheduleReconnect();
      });
      ws.addEventListener("error", () => {
        this.lastError = "websocket error";
      });
    } catch (e) {
      this.lastError = String((e as Error).message || e);
      this.scheduleReconnect();
    }
  }

  private async onMessage(raw: string): Promise<void> {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = msg.type;

    if (type === "hello") {
      // MCP acknowledges pairing
      this.setState("paired", "paired with askjev-mcp");
      return;
    }
    if (type === "pong") return;
    if (type === "error") {
      this.lastError = String(msg.message || msg.code || "error");
      if (msg.code === "unauthorized") {
        this.setState("error", "unauthorized — check pairing token");
        this.stop();
        this.stopped = false; // allow later sync to restart after token fix
      }
      return;
    }
    if (type === "rpc") {
      await this.onRpc(msg);
    }
  }

  private async onRpc(msg: Record<string, unknown>): Promise<void> {
    const id = String(msg.id || "");
    const token = String(msg.token || "");
    const method = String(msg.method || "");
    const params = (msg.params || {}) as Record<string, unknown>;

    const reply = (payload: {
      ok: boolean;
      result?: unknown;
      error?: { code: string; message: string };
    }) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(
          JSON.stringify({
            type: "rpc_result",
            id,
            ok: payload.ok,
            result: payload.result,
            error: payload.error,
          }),
        );
      }
    };

    if (!this.settings || !tokensEqual(token, this.settings.bridgeToken)) {
      reply({
        ok: false,
        error: { code: "unauthorized", message: "invalid pairing token" },
      });
      return;
    }

    try {
      const result = await this.handleRpc(method, params);
      reply({ ok: true, result });
    } catch (e) {
      const err = e as Error & { code?: string };
      reply({
        ok: false,
        error: {
          code: err.code || "internal",
          message: err.message || String(e),
        },
      });
    }
  }

  /** Emit a fire-and-forget event to the MCP bridge (logs / status). */
  emit(event: string, data?: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN && this.settings?.bridgeToken) {
      this.ws.send(
        JSON.stringify({
          type: "event",
          event,
          data,
          token: this.settings.bridgeToken,
        }),
      );
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.reconnectAttempt += 1;
    const delay = Math.min(30_000, 500 * 2 ** Math.min(this.reconnectAttempt, 6));
    this.setState("backoff", `reconnect in ${Math.round(delay / 1000)}s`);
    this.clearReconnect();
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startPing(): void {
    this.clearPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN && this.settings?.bridgeToken) {
        this.ws.send(
          JSON.stringify({ type: "ping", token: this.settings.bridgeToken }),
        );
      }
    }, 20_000);
  }

  private clearPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private setState(state: BridgeConnectionState, detail: string): void {
    this.state = state;
    this.detail = detail;
    this.onStatus?.(this.getSnapshot());
  }
}

/** Guard Mode B acts: irreversible ≥ 0.65 blocks (same threshold as Autopilot). */
export async function guardAct(input: {
  apiKey: string;
  model: string;
  sensitivity: AskJevSettings["sensitivity"];
  action: DomAction;
  targetId?: number;
  text?: string;
  pageState: string;
}): Promise<{ blocked: boolean; irreversible: number }> {
  const skip =
    input.action === "SCROLL_DOWN" ||
    input.action === "SCROLL_UP" ||
    input.action === "WAIT" ||
    input.action === "DONE";
  if (skip) return { blocked: false, irreversible: 0 };

  const state = [
    input.pageState,
    `proposed_action: ${input.action} targetId=${input.targetId ?? "none"} text=${(input.text || "").slice(0, 80)}`,
  ].join("\n");

  const result = await callJev({
    state,
    apiKey: input.apiKey,
    model: input.model,
    sensitivity: input.sensitivity,
  });
  const irreversible = Number(result.answers?.irreversible?.noul ?? 0);
  return { blocked: irreversible >= 0.65, irreversible };
}

export function bridgeError(code: string, message: string): Error & { code: string } {
  const e = new Error(message) as Error & { code: string };
  e.code = code;
  return e;
}
