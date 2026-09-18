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
