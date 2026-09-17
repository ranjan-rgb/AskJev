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
  // communicate / commit
  "send",
  "submit",
  "publish",
  "post",
  "share",
  "invite",
  "confirm",
  "accept",
  "agree",
  "authorize",
  "approve",
  "grant access",
  // ship / prod
  "deploy",
  "merge",
  "release",
  "promote",
  "roll out",
  "execute",
  "run workflow",
  "i understand",
  "yes, delete",
  "permanently",
] as const;

export const DESTRUCTIVE_CLASS_RE =
  /\b(danger|destructive|error|warning|btn-danger|btn-error|bg-red|text-red)\b/i;
