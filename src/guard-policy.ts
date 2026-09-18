/**
 * Guard overlay timing — pure helpers so we can regression-test without a browser.
 * Autopilot Jev uses 15s; Guard used to use 8s and flaked on slow System One.
 */

/** How long Guard waits for askjev.decide before showing a dismissible timeout. */
export const GUARD_JEV_TIMEOUT_MS = 12_000;

/** After Dismiss / Escape, clicks pass through without re-arming Guard. */
export const GUARD_DISMISS_PASSTHROUGH_MS = 1_500;

/** Brief pass-through after an allowed click so the synthetic click is not re-gated. */
export const GUARD_ALLOW_PASSTHROUGH_MS = 800;

export function guardJevTimeoutMessage(): string {
  return "jev_timeout — press Escape or Dismiss to browse";
}

/** Irreversible score at or above which Guard freezes the click. */
export const GUARD_IRREVERSIBLE_BLOCK = 0.65;
/** Below this irreversible score a confident "proceed" passes with no overlay. */
export const GUARD_QUIET_PROCEED_IRREVERSIBLE = 0.55;
/** Minimum Jev confidence for a silent proceed. */
export const GUARD_QUIET_PROCEED_CONFIDENCE = 0.45;

export type GuardOutcome = "allow" | "block" | "confirm";

export interface GuardVerdict {
  outcome: GuardOutcome;
  /** Short machine-readable cause, surfaced in the overlay and stats. */
  reason: string;
}

/**
 * Turn a System One answer into what Guard should do with the click.
 *
 * Fails CLOSED: anything we cannot read — a 200 with no answers, an
 * unrecognised choice, a non-numeric score — asks the human rather than
 * passing the click through. Guard gates payments and deletions, so an
 * unevaluated click must never be treated as an approved one.
 */
export function resolveGuardVerdict(input: {
  choice?: string | null;
  irreversible?: unknown;
  confidence?: unknown;
  requireConfirmOnAsk?: boolean;
}): GuardVerdict {
  const choice = input.choice;
  if (choice !== "proceed" && choice !== "block" && choice !== "ask") {
    return { outcome: "confirm", reason: "unreadable_decision" };
  }

  const irr = Number(input.irreversible ?? NaN);
  const conf = Number(input.confidence ?? NaN);
  if (!Number.isFinite(irr) || !Number.isFinite(conf)) {
    return { outcome: "confirm", reason: "unreadable_scores" };
  }

  if (choice === "block") {
    return { outcome: "block", reason: "jev_block" };
  }
  if (choice === "ask" && irr >= GUARD_IRREVERSIBLE_BLOCK) {
    return { outcome: "block", reason: "irreversible" };
  }
  if (
    choice === "proceed" &&
    conf >= GUARD_QUIET_PROCEED_CONFIDENCE &&
    irr < GUARD_QUIET_PROCEED_IRREVERSIBLE
  ) {
    return { outcome: "allow", reason: "confident_proceed" };
  }
  if (input.requireConfirmOnAsk !== true && irr < GUARD_IRREVERSIBLE_BLOCK) {
    return { outcome: "allow", reason: "quiet_default" };
  }
  return { outcome: "confirm", reason: "ask" };
}

/** Epoch ms until which Guard should ignore click interception. */
export function passThroughUntilFrom(
  kind: "dismiss" | "allow",
  now = Date.now(),
): number {
  const ms =
    kind === "dismiss"
      ? GUARD_DISMISS_PASSTHROUGH_MS
      : GUARD_ALLOW_PASSTHROUGH_MS;
  return now + ms;
}

/** True while Guard should let the click through (Dismiss / Allow once / Escape). */
export function isPassThroughActive(
  passThroughUntil: number,
  now = Date.now(),
): boolean {
  return now < passThroughUntil;
}

/**
 * Dismiss / Escape: hide overlay, clear busy, arm a short pass-through.
 * Does NOT fire Allow (no click) and does NOT keep the page frozen.
 */
export function applyGuardDismiss(input: {
  now?: number;
}): { busy: false; passThroughUntil: number } {
  return {
    busy: false,
    passThroughUntil: passThroughUntilFrom("dismiss", input.now ?? Date.now()),
  };
}
