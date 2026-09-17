/** Structured error codes returned to MCP clients and over the bridge. */
export type BridgeErrorCode =
  | "not_paired"
  | "bridge_offline"
  | "guard_blocked"
  | "missing_api_key"
  | "rate_limited"
  | "unauthorized"
  | "timeout"
  | "invalid_params"
  | "internal";

export class BridgeError extends Error {
  readonly code: BridgeErrorCode;
  constructor(code: BridgeErrorCode, message?: string) {
    super(message || code);
    this.name = "BridgeError";
    this.code = code;
  }

  toJSON(): { code: BridgeErrorCode; message: string } {
    return { code: this.code, message: this.message };
  }
}
