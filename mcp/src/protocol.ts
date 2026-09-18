/** AskJev agent-bridge wire protocol (extension ↔ MCP WS server). */

export const PROTOCOL_VERSION = "1.0";
export const DEFAULT_BRIDGE_PORT = 17373;

/** "extension" = Chrome client (one). "mcp" = bridge owner hello reply. "controller" = peer MCP (many). */
export type BridgeRole = "extension" | "mcp" | "controller";

export interface HelloMessage {
  type: "hello";
  token: string;
  role: BridgeRole;
  version: string;
}

export interface RpcMessage {
  type: "rpc";
  id: string;
  token: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface RpcResultMessage {
  type: "rpc_result";
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

export interface EventMessage {
  type: "event";
  event: string;
  data?: unknown;
  /** Present when extension emits events (authenticated). */
  token?: string;
}

export interface PingMessage {
  type: "ping";
  token: string;
}

export interface PongMessage {
  type: "pong";
}

export interface ErrorMessage {
  type: "error";
  code: string;
  message: string;
}

export type BridgeMessage =
  | HelloMessage
  | RpcMessage
  | RpcResultMessage
  | EventMessage
  | PingMessage
  | PongMessage
  | ErrorMessage;

export type RpcMethod =
  | "start_goal"
  | "stop"
  | "status"
  | "snapshot"
  | "act"
  | "list_tabs";

/** Synthetic RPC answered by the bridge owner (not forwarded to the extension). */
export const BRIDGE_STATUS_METHOD = "__bridge_status";
