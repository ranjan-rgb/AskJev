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
import {
  decideNextStep,
  extractQuotedText,
  missingApiKeyError,
  resolveApiKey,
  type AutopilotAction,
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

const IRREVERSIBLE_THRESHOLD = 0.65;
const JEV_TIMEOUT_MS = 15_000;
const STEP_PAUSE_MS = 700;

let running = false;
let stopRequested = false;
let lastStatus = "idle";
let currentGoal: string | undefined;
let currentStep: number | undefined;
let lastAction: string | undefined;

function maxSteps(): number {
  const n = Number(process.env.ASKJEV_MAX_STEPS || 25);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 100) : 25;
}

function setStatus(status: string): void {
  lastStatus = status;
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
  setStatus("stopped");
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

async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error(label)), ms),
    ),
  ]);
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

  if (running) {
    stopRequested = true;
    await new Promise((r) => setTimeout(r, 150));
  }

  running = true;
  stopRequested = false;
  currentGoal = goal;
  currentStep = 0;
  lastAction = undefined;
  setStatus("running");

  const steps: string[] = [];
  const limit = maxSteps();
  const typeText =
    (input.typeText && String(input.typeText).trim()) ||
    extractQuotedText(goal) ||
    undefined;

  try {
    const nav = extractNavigateUrl(goal);
    if (nav) {
      steps.push(`navigate ${nav}`);
      setStatus(`navigating ${nav}`);
      await navigate(nav);
      await new Promise((r) => setTimeout(r, STEP_PAUSE_MS));
    } else {
      steps.push("no URL in goal — using current tab");
    }

    for (let step = 1; step <= limit && running && !stopRequested; step++) {
      currentStep = step;
      setStatus(`step ${step}/${limit}: snapshot`);
      steps.push(`step ${step}: snapshot`);

      const snap = await snapshot(goal);
      setStatus(`step ${step}/${limit}: asking jev…`);
      steps.push(`step ${step}: asking jev…`);

      let decision;
      try {
        decision = await withTimeout(
          decideNextStep({
            apiKey,
            state: snap.state,
            elements: snap.elements,
            model: "jev-latest",
            step,
          }),
          JEV_TIMEOUT_MS,
          "jev_timeout_15s",
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        steps.push(`jev error: ${msg}`);
        setStatus("jev error — check API key / network");
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
        setStatus("done");
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
        setStatus("blocked by jev");
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
        setStatus(note);
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

      const actAction = toActAction(decision.action);
      if (!actAction) {
        steps.push(`skipped unknown action ${decision.action}`);
        continue;
      }

      try {
        const result = await act({
          action: actAction,
          targetId: decision.targetId ?? undefined,
          text: typeText,
        });
        steps.push(result.detail);
        setStatus(`step ${step}: ${result.detail}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        steps.push(`act failed: ${msg}`);
        setStatus(`act failed: ${msg}`);
      }

      await new Promise((r) => setTimeout(r, STEP_PAUSE_MS));
    }

    if (stopRequested) {
      setStatus("stopped");
      return {
        ok: false,
        goal,
        steps,
        note: "Autopilot stopped by askjev_stop.",
      };
    }

    setStatus(`max steps (${limit})`);
    return {
      ok: false,
      goal,
      steps,
      note: `Reached ASKJEV_MAX_STEPS=${limit} without DONE. Raise ASKJEV_MAX_STEPS or refine the goal.`,
    };
  } finally {
    running = false;
    if (lastStatus === "running") setStatus("idle");
  }
}
