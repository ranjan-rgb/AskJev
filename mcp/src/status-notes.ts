import type { BridgeStatus } from "./bridge-server.js";
import type { BridgeErrorCode } from "./errors.js";

/** Actionable hints for MCP tool errors (Claude sees these next to the code). */
export function bridgeErrorHint(code: BridgeErrorCode): string | undefined {
  switch (code) {
    case "not_paired":
      return (
        "Open AskJev Options → Auto-connect (or enable Agent Bridge), keep Chrome " +
        "open on a normal tab, confirm popup shows paired/Connected, then retry askjev_status."
      );
    case "bridge_offline":
      return (
        "The MCP bridge process is up but the extension is not dialed in. " +
        "Enable Agent Bridge in Options, ensure ASKJEV_TOKEN matches the extension pairing token, " +
        "then call askjev_status."
      );
    case "missing_api_key":
      return "Paste your TypeSafe API key in AskJev Options, then retry.";
    case "guard_blocked":
      return "AskJev Guard blocked an irreversible act (≥0.65). Narrow the goal or use a lower-risk step.";
    case "rate_limited":
      return "askjev_act is limited to 30/min — wait a moment and retry.";
    case "timeout":
      return (
        "RPC timed out waiting for the extension/Jev. Check network to api.typesafe.ai, " +
        "refresh the active tab, and retry."
      );
    case "unauthorized":
      return "Pairing token mismatch — re-run Auto-connect and update Claude/Cursor ASKJEV_TOKEN.";
    default:
      return undefined;
  }
}

/** Explain listen (server) vs attach (peer) so Claude knows which process owns the port. */
export function bridgeModeNote(status: Pick<BridgeStatus, "mode" | "port" | "controllers">): string {
  if (status.mode === "attach") {
    return (
      `mode=attach: this MCP process is a peer controller on 127.0.0.1:${status.port} ` +
      `(Claude Desktop Chat + Cowork/Code double-spawn). Another process owns the listener; ` +
      `both share the same extension pairing.`
    );
  }
  const n = status.controllers ?? 0;
  return (
    `mode=listen (server): this MCP process owns the WebSocket listener on 127.0.0.1:${status.port}. ` +
    `The Chrome extension dials in to pair.` +
    (n > 0 ? ` ${n} peer controller(s) attached.` : "")
  );
}

export function unpairedStatusNote(status: Pick<BridgeStatus, "mode" | "port">): string {
  const mode =
    status.mode === "attach"
      ? "attached as peer"
      : `listening on 127.0.0.1:${status.port}`;
  return (
    `Extension not paired (${mode}). Enable Agent Bridge / Auto-connect in AskJev Options, ` +
    `keep Chrome open, ensure ASKJEV_TOKEN matches, then retry askjev_status.`
  );
}
