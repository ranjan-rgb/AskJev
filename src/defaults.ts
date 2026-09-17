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
  model: "jev-latest",
  stats: { blocked: 0, asked: 0, proceeded: 0, errors: 0 },
};

export const BASE_KEYWORDS = [
  "buy",
  "purchase",
  "pay",
  "checkout",
  "place order",
  "confirm payment",
  "delete",
  "remove forever",
  "destroy",
  "send",
  "submit",
  "approve",
  "deploy",
  "merge",
  "transfer",
  "withdraw",
  "unsubscribe",
  "cancel subscription",
  "wire",
  "payout",
] as const;
