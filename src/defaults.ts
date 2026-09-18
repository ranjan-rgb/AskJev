export type Sensitivity = "chill" | "balanced" | "paranoid";

export interface AskJevStats {
  blocked: number;
  asked: number;
  proceeded: number;
  errors: number;
}

export interface AskJevSettings {
  enabled: boolean;
  apiKey?: string;
  sensitivity: Sensitivity;
  customKeywords: string[];
  allowlist: string[];
  requireConfirmOnAsk: boolean;
  showOverlayOnProceed: boolean;
  /** When true (paranoid default), also gate plain form submits / primary CTAs. */
  gateFormSubmits: boolean;
  model: string;
  stats: AskJevStats;
  /** Agent bridge: connect to local askjev-mcp WebSocket. */
  bridgeEnabled: boolean;
  /** Pairing token (hex, 32+ bytes). Empty until generated. */
  bridgeToken: string;
  /** Local bridge port (MCP listens here). */
  bridgePort: number;
}

export const DEFAULTS: AskJevSettings = {
  enabled: true,
  sensitivity: "balanced",
  customKeywords: [],
  allowlist: [],
  requireConfirmOnAsk: true,
  showOverlayOnProceed: false,
  gateFormSubmits: false,
  model: "jev-latest",
  stats: { blocked: 0, asked: 0, proceeded: 0, errors: 0 },
  bridgeEnabled: false,
  bridgeToken: "",
  bridgePort: 17373,
};

/** Broad irreversible / high-impact action vocabulary — not just payments. */
export const BASE_KEYWORDS = [
  // money
  "buy",
  "purchase",
  "pay",
  "checkout",
  "place order",
  "confirm payment",
  "order now",
  "complete purchase",
  "add card",
  "wire",
  "payout",
  "transfer",
  "withdraw",
  "deposit",
  "subscribe",
  "unsubscribe",
  "cancel subscription",
  "upgrade",
  "downgrade",
  // destroy / mutate
  "delete",
  "remove forever",
  "destroy",
  "erase",
  "wipe",
  "purge",
  "archive",
  "revoke",
  "disable",
  "deactivate",
  "terminate",
  "close account",
  "reset",
  // communicate / commit — strong only (not bare "post"/"send" which break X/Twitter etc.)
  "publish",
  "invite",
  "authorize",
  "approve",
  "grant access",
  "yes, delete",
  "permanently",
  // ship / prod
  "deploy",
  "merge",
  "release",
  "promote",
  "roll out",
  "execute",
  "run workflow",
  "i understand",
] as const;

/** Extra gates only for real buttons/submits — not plain navigation links. */
export const BUTTON_ONLY_KEYWORDS = [
  "send",
  "submit",
  "post",
  "share",
  "confirm",
  "accept",
  "agree",
] as const;

export const DESTRUCTIVE_CLASS_RE =
  /\b(danger|destructive|error|warning|btn-danger|btn-error|bg-red|text-red)\b/i;

/** Generate a crypto-random pairing token (32 bytes → 64 hex chars). */
export function generateBridgeToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
