export const DEFAULTS = {
  enabled: true,
  sensitivity: "balanced", // chill | balanced | paranoid
  customKeywords: [],
  allowlist: [],
  blocklistForce: [],
  showOverlayOnProceed: false,
  requireConfirmOnAsk: true,
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
];
