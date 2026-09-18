/**
 * TypeSafe Jev Autopilot loop for Playwright/CDP.
 * Port of extension background runAutopilot — decisions via System One only.
 */
import {
  act,
  extractNavigateUrl,
  navigate,
  snapshot,
  type ActAction,
  type DoGoalResult,
} from "./cdp-browser.js";
import { BridgeError } from "./errors.js";
import {
  decideNextStep,
  extractQuotedText,
  missingApiKeyError,
  resolveApiKey,
  type AutopilotAction,
  type SnapshotElement,
} from "./jev-client.js";

export type AutopilotStatusSnapshot = {
  running: boolean;
  status: string;
  goal?: string;
  step?: number;
  maxSteps: number;
  lastAction?: string;
  hasApiKey: boolean;
};

/** Product invariant — do not tune. Anything at/above this never executes. */
const IRREVERSIBLE_THRESHOLD = 0.65;
/** Confidence-routing floor for page-changing actions (ASKJEV_MIN_CONFIDENCE). */
export const DEFAULT_MIN_CONFIDENCE = 0.45;
const JEV_TIMEOUT_MS = 15_000;
const STEP_PAUSE_MS = 700;
/** How long a new run waits for the previous loop to actually finish. */
const TAKEOVER_TIMEOUT_MS = 20_000;
/** Same action+target this many times in a row — Jev is looping. */
export const REPEAT_LIMIT = 3;
/** Identical page fingerprint this many snapshots in a row — nothing is moving. */
export const NO_PROGRESS_LIMIT = 4;
/** Cheap scroll probes allowed before a low-confidence run gives up. */
export const MAX_LOW_CONFIDENCE_PROBES = 2;

let running = false;
let stopRequested = false;
let lastStatus = "idle";
let statusIsFinal = true;
let currentGoal: string | undefined;
let currentStep: number | undefined;
let lastAction: string | undefined;
/** Handle on the loop in flight so a second call can await it, not guess at it. */
let inFlight: Promise<DoGoalResult> | null = null;

function maxSteps(): number {
  const n = Number(process.env.ASKJEV_MAX_STEPS || 25);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 100) : 25;
}

/** Floor for acting on Jev's chosen action; clamped so a typo cannot disable the gate. */
export function minConfidence(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = (env.ASKJEV_MIN_CONFIDENCE || "").trim();
  if (!raw) return DEFAULT_MIN_CONFIDENCE;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) return DEFAULT_MIN_CONFIDENCE;
  return n;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function setStatus(status: string): void {
  lastStatus = status;
  statusIsFinal = false;
}

/**
 * Status for a run that has ended. Marked final so the `finally` block does not
 * overwrite it — and so askjev_status never reports a finished run as live.
 */
function setFinalStatus(status: string): void {
  lastStatus = status;
  statusIsFinal = true;
}

export function getAutopilotStatus(): AutopilotStatusSnapshot {
  return {
    running,
    status: lastStatus,
    goal: currentGoal,
    step: currentStep,
    maxSteps: maxSteps(),
    lastAction,
    hasApiKey: Boolean(resolveApiKey()),
  };
}

export function requestAutopilotStop(): { stopped: boolean; status: string } {
  stopRequested = true;
  running = false;
  setFinalStatus("stopped");
  return { stopped: true, status: lastStatus };
}

function toActAction(action: AutopilotAction): ActAction | null {
  if (
    action === "CLICK" ||
    action === "TYPE_TEXT" ||
    action === "SELECT" ||
    action === "SCROLL_DOWN" ||
    action === "SCROLL_UP" ||
    action === "WAIT"
  ) {
    return action;
  }
  return null;
}

/** Actions that change the page — the ones worth gating on confidence. */
function isPageChanging(action: AutopilotAction): boolean {
  return action === "CLICK" || action === "TYPE_TEXT" || action === "SELECT";
}

/** Identity of one decision, so repeats are comparable across steps. */
export function stepKey(
  action: AutopilotAction,
  targetId: number | null | undefined,
): string {
  return `${action}#${targetId ?? "none"}`;
}

/** 32-bit FNV-1a — keeps the element fingerprint short and comparable. */
function hash32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

/**
 * Fingerprint of what the user would see. Includes element values so filling a
 * form counts as progress even when the URL and title never change.
 */
export function pageSignature(page: {
  url: string;
  title: string;
  elements: Pick<SnapshotElement, "id" | "role" | "name" | "value">[];
}): string {
  const shape = page.elements
    .map((e) => `${e.id}:${e.role}:${e.name}:${e.value ?? ""}`)
    .join("|");
  return `${page.url}\n${page.title}\n${page.elements.length}\n${hash32(shape)}`;
}

export type StuckReason = "repeat" | "oscillation" | "no-progress";

/**
 * Detect a loop that is burning steps (and TypeSafe quota) without moving.
 * Pure so it is unit-testable without a browser.
 *
 * Scrolls get more rope than clicks: a lazy-loading feed legitimately needs
 * several SCROLL_DOWNs, so a repeated scroll only counts as stuck when the page
 * fingerprint also stopped changing.
 */
export function detectStuck(
  keys: string[],
  signatures: string[],
): { reason: StuckReason; note: string } | null {
  const last = keys[keys.length - 1];

  if (keys.length >= 4) {
    const [a, b, c, d] = keys.slice(-4);
    const scrolls = [a, b, c, d].every((k) => k.startsWith("SCROLL_"));
    if (scrolls && a === c && b === d && a !== b) {
      return {
        reason: "oscillation",
        note: `stuck: Jev is oscillating between ${b.split("#")[0]} and ${a.split("#")[0]} — the target is probably not on this page. Refine the goal or start from a more specific URL.`,
      };
    }
  }

  if (keys.length >= REPEAT_LIMIT && last) {
    const repeated = keys.slice(-REPEAT_LIMIT).every((k) => k === last);
    const cheap = last.startsWith("SCROLL_") || last.startsWith("WAIT");
    const pageFrozen =
      signatures.length >= REPEAT_LIMIT &&
      signatures.slice(-REPEAT_LIMIT).every((s) => s === signatures[signatures.length - 1]);
    if (repeated && (!cheap || pageFrozen)) {
      return {
        reason: "repeat",
        note: `stuck: Jev chose ${last} ${REPEAT_LIMIT} times in a row with no effect — stopping instead of burning the remaining steps. Refine the goal or act on that control manually.`,
      };
    }
  }

  if (signatures.length >= NO_PROGRESS_LIMIT) {
    const recent = signatures.slice(-NO_PROGRESS_LIMIT);
    if (recent.every((s) => s === recent[0])) {
      return {
        reason: "no-progress",
        note: `stuck: URL, title and element list are unchanged across ${NO_PROGRESS_LIMIT} steps — the page is not responding to Jev's actions. Refine the goal, or check for a login wall / dialog.`,
      };
    }
  }

  return null;
}

export interface TypeTextSource {
  /** Hand the text to one TYPE_TEXT step; every later call returns undefined. */
  take(): string | undefined;
  /** An act() that threw never reached the page — the text is still unspent. */
  restore(text: string): void;
  remaining(): string | undefined;
}

/**
 * One-shot supply of the text to type. The string belongs to the step Jev asked
 * for it on: passing it to every act() meant a two-field form got the same
 * value in both fields, forever.
 */
export function createTypeTextSource(initial?: string): TypeTextSource {
  let pending = (initial && String(initial).trim()) || undefined;
  return {
    take() {
      const text = pending;
      pending = undefined;
      return text;
    },
    restore(text: string) {
      if (!pending) pending = text;
    },
    remaining() {
      return pending;
    },
  };
}

export type ConfidenceGate =
  | { kind: "proceed" }
  | { kind: "probe"; note: string }
  | { kind: "stop"; note: string };

/**
 * Confidence-gated routing (TypeSafe patterns/confidence-routing).
 *
 * A low-confidence CLICK/TYPE_TEXT/SELECT is the expensive kind of wrong: it
 * navigates away, mutates a field, or trips a UI the user did not ask for. So
 * instead of executing it we spend a cheap SCROLL_DOWN probe — more elements in
 * the next snapshot usually resolve the ambiguity — and only give up if Jev is
 * still unsure afterwards. Scrolls and waits are never gated: they are the
 * fallback, and gating them would deadlock the loop.
 *
 * This is independent of IRREVERSIBLE_THRESHOLD (0.65), which is checked first
 * and is about consequence, not certainty.
 */
export function gateLowConfidence(input: {
  action: AutopilotAction;
  confidence: number;
  minConfidence: number;
  probesUsed: number;
}): ConfidenceGate {
  if (!isPageChanging(input.action)) return { kind: "proceed" };
  if (input.confidence >= input.minConfidence) return { kind: "proceed" };

  const seen = `${input.confidence.toFixed(2)} < ${input.minConfidence.toFixed(2)}`;
  if (input.probesUsed < MAX_LOW_CONFIDENCE_PROBES) {
    return {
      kind: "probe",
      note: `low confidence (${seen}) on ${input.action} — scrolling for more context instead of acting blind`,
    };
  }
  return {
    kind: "stop",
    note: `guard: Jev stayed unsure about ${input.action} (${seen}) after ${MAX_LOW_CONFIDENCE_PROBES} scroll probes — stopped rather than clicking blind. Refine the goal, name the control, or lower ASKJEV_MIN_CONFIDENCE.`,
  };
}

/**
 * Await a settled run (resolved or rejected) within a bound.
 * Returns false when the old loop is still going, so the caller can refuse to
 * start a second one rather than drive the same browser twice.
 */
export async function waitForRun(
  run: Promise<unknown>,
  timeoutMs: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([
      run.then(
        () => true,
        () => true,
      ),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Run Jev-driven multi-step autopilot against the CDP/Playwright browser.
 * Requires ASKJEV_API_KEY or TYPESAFE_API_KEY — never falls back to silent scroll.
 */
export async function runJevAutopilot(input: {
  goal: string;
  typeText?: string;
}): Promise<DoGoalResult> {
  const goal = String(input.goal || "").trim();
  if (!goal) {
    throw new Error("goal is required");
  }

  const apiKey = resolveApiKey();
  if (!apiKey) {
    throw missingApiKeyError();
  }

  // Two loops must never drive one browser. Ask the in-flight run to stop and
  // actually wait for it — the old fixed 150ms sleep returned while the previous
  // act() was still clicking, so both loops fought over the same page.
  if (inFlight) {
    stopRequested = true;
    const settled = await waitForRun(inFlight, TAKEOVER_TIMEOUT_MS);
    if (!settled) {
      throw new BridgeError(
        "internal",
        `A previous AskJev task is still finishing (waited ${TAKEOVER_TIMEOUT_MS / 1000}s). Ask again in a moment, or stop it first.`,
      );
    }
  }

  const run = executeRun(goal, apiKey, input.typeText);
  inFlight = run;
  try {
    return await run;
  } finally {
    if (inFlight === run) inFlight = null;
  }
}

async function executeRun(
  goal: string,
  apiKey: string,
  requestedText?: string,
): Promise<DoGoalResult> {
  running = true;
  stopRequested = false;
  currentGoal = goal;
  currentStep = 0;
  lastAction = undefined;
  setStatus("running");

  const steps: string[] = [];
  const limit = maxSteps();
  const confidenceFloor = minConfidence();
  const typeText = createTypeTextSource(
    (requestedText && String(requestedText).trim()) ||
      extractQuotedText(goal) ||
      undefined,
  );
  const recentKeys: string[] = [];
  const recentSignatures: string[] = [];
  let probesUsed = 0;

  try {
    const nav = extractNavigateUrl(goal);
    if (nav) {
      steps.push(`navigate ${nav}`);
      setStatus(`navigating ${nav}`);
      await navigate(nav);
      await sleep(STEP_PAUSE_MS);
    } else {
      steps.push("no URL in goal — using current tab");
    }

    for (let step = 1; step <= limit && running && !stopRequested; step++) {
      currentStep = step;
      setStatus(`step ${step}/${limit}: snapshot`);
      steps.push(`step ${step}: snapshot`);

      const snap = await snapshot(goal);
      recentSignatures.push(pageSignature(snap));
      setStatus(`step ${step}/${limit}: asking jev…`);
      steps.push(`step ${step}: asking jev…`);

      let decision;
      try {
        decision = await decideNextStep({
          apiKey,
          page: {
            goal,
            url: snap.url,
            title: snap.title,
            step,
            history: steps,
            elements: snap.elements,
          },
          model: "jev-latest",
          timeoutMs: JEV_TIMEOUT_MS,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        steps.push(`jev error: ${msg}`);
        setFinalStatus("jev error — check API key / network");
        return {
          ok: false,
          goal,
          steps,
          url: snap.url,
          title: snap.title,
          note: `Jev decision failed: ${msg}`,
        };
      }

      const line = `jev → ${decision.action} target=${decision.targetId ?? "none"} irr=${decision.irreversible.toFixed(2)} conf=${decision.confidence.toFixed(2)}`;
      steps.push(line);
      lastAction = decision.action;
      setStatus(line);

      if (decision.done || decision.action === "DONE") {
        setFinalStatus("done");
        return {
          ok: true,
          goal,
          steps,
          url: snap.url,
          title: snap.title,
          note: "Jev Autopilot completed the goal (System One).",
        };
      }

      if (decision.action === "BLOCKED") {
        setFinalStatus("blocked by jev");
        return {
          ok: false,
          goal,
          steps,
          url: snap.url,
          title: snap.title,
          note: "Jev chose BLOCKED — cannot proceed safely.",
        };
      }

      if (decision.irreversible >= IRREVERSIBLE_THRESHOLD) {
        const note = `guard: irreversible (${decision.irreversible.toFixed(2)}) ≥ ${IRREVERSIBLE_THRESHOLD} — stopped. Narrow the goal or confirm manually.`;
        setFinalStatus(note);
        steps.push(note);
        return {
          ok: false,
          goal,
          steps,
          url: snap.url,
          title: snap.title,
          note,
        };
      }

      // Repeat/oscillation check runs before acting so the wasted step is the
      // last one, not the 25th.
      recentKeys.push(stepKey(decision.action, decision.targetId));
      const stuck = detectStuck(recentKeys, recentSignatures);
      if (stuck) {
        steps.push(stuck.note);
        setFinalStatus(stuck.note);
        return {
          ok: false,
          goal,
          steps,
          url: snap.url,
          title: snap.title,
          note: stuck.note,
        };
      }

      const gate = gateLowConfidence({
        action: decision.action,
        confidence: decision.confidence,
        minConfidence: confidenceFloor,
        probesUsed,
      });
      if (gate.kind === "stop") {
        steps.push(gate.note);
        setFinalStatus(gate.note);
        return {
          ok: false,
          goal,
          steps,
          url: snap.url,
          title: snap.title,
          note: gate.note,
        };
      }

      let actAction = toActAction(decision.action);
      let targetId = decision.targetId ?? undefined;
      let text: string | undefined;

      if (gate.kind === "probe") {
        probesUsed++;
        steps.push(gate.note);
        setStatus(gate.note);
        actAction = "SCROLL_DOWN";
        targetId = undefined;
      } else if (!actAction) {
        steps.push(`skipped unknown action ${decision.action}`);
        continue;
      } else if (actAction === "TYPE_TEXT") {
        text = typeText.take();
        if (!text) {
          // Nothing left to type — act() would fill("") and wipe whatever the
          // user (or an earlier step) already put there, so skip the step and
          // let Jev choose something else with the skip visible in history.
          const note = `step ${step}: no text left for TYPE_TEXT — skipped (pass typeText or quote the text in the goal)`;
          steps.push(note);
          setStatus(note);
          continue;
        }
      }

      try {
        const result = await act({ action: actAction, targetId, text });
        steps.push(result.detail);
        setStatus(`step ${step}: ${result.detail}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        steps.push(`act failed: ${msg}`);
        setStatus(`act failed: ${msg}`);
        // A failed TYPE_TEXT never reached the page — keep the text for a retry.
        if (actAction === "TYPE_TEXT" && text) typeText.restore(text);
      }

      await sleep(STEP_PAUSE_MS);
    }

    if (stopRequested) {
      setFinalStatus("stopped");
      return {
        ok: false,
        goal,
        steps,
        note: "Autopilot stopped by askjev_stop.",
      };
    }

    setFinalStatus(`max steps (${limit})`);
    return {
      ok: false,
      goal,
      steps,
      note: `Reached ASKJEV_MAX_STEPS=${limit} without DONE. Raise ASKJEV_MAX_STEPS or refine the goal.`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setFinalStatus(`error: ${msg}`);
    throw e;
  } finally {
    running = false;
    // The old guard compared lastStatus to "running", which every step had
    // already overwritten — so a finished run kept reporting a live step line.
    // Every labelled exit now marks its status final; anything else falls back.
    if (!statusIsFinal) setFinalStatus("idle");
  }
}
