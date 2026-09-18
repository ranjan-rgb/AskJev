import type { DomAction, DomElement } from "./dom.js";
import { SYSTEM_ONE_URL } from "./jev.js";

export interface AutopilotDecision {
  action: DomAction;
  targetId: number | null;
  confidence: number;
  done: boolean;
  irreversible: number;
}

const ACTIONS: DomAction[] = [
  "CLICK",
  "TYPE_TEXT",
  "SELECT",
  "SCROLL_DOWN",
  "SCROLL_UP",
  "WAIT",
  "DONE",
  "BLOCKED",
];

export async function decideNextStep(input: {
  apiKey: string;
  state: string;
  elements: DomElement[];
  model?: string;
  /** 1-based autopilot step — used to block premature DONE on step 1. */
  step?: number;
}): Promise<AutopilotDecision> {
  const criteria: Record<string, string> = {
    CLICK: "Click a visible control to progress the goal",
    TYPE_TEXT: "Type text into an input/textarea (text comes from goal quotes or sidepanel)",
    SELECT: "Choose from a dropdown",
    SCROLL_DOWN: "Scroll down to reveal more",
    SCROLL_UP: "Scroll up",
    WAIT: "Wait for page to settle",
    DONE: "Goal is complete — stop",
    BLOCKED: "Cannot proceed safely or page is stuck",
  };

  // Cap targets for Choice cardinality
  const targets = input.elements.slice(0, 60);
  const targetCriteria: Record<string, string> = { none: "No element needed (scroll/wait/done/blocked)" };
  for (const e of targets) {
    targetCriteria[`e${e.id}`] =
      `#${e.id} ${e.tag} "${e.name || e.value || e.href || e.type}"`;
  }

  const body = {
    model: input.model || "jev-latest",
    state: input.state,
    questions: {
      action: {
        type: "choice",
        instructions:
          "Pick the single next browser action to advance the user goal. Only choose DONE if the goal is visibly complete on this page (e.g. the followers list is already open and readable). Being on a home/feed/profile landing page is NOT done — click the Followers/Profile control next. Prefer BLOCKED if unsafe or impossible.",
        criteria,
      },
      target: {
        type: "choice",
        instructions:
          "Pick the element id for CLICK/TYPE_TEXT/SELECT. Use none for scroll/wait/done/blocked.",
        criteria: targetCriteria,
      },
      irreversible: {
        type: "noul",
        instructions:
          "Would executing this next action cause lasting harm (pay, delete, send, publish, deploy, revoke, grant access)?",
      },
      goal_done: {
        type: "noul",
        instructions:
          "Is the user goal FULLY satisfied by what is already visible? Answer low unless the exact destination UI is on screen (e.g. followers list visible). Home feeds and generic profiles are not enough.",
      },
    },
  };

  const res = await fetch(SYSTEM_ONE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as {
    answers?: {
      action?: { choice?: string; confidence?: number };
      target?: { choice?: string; confidence?: number };
      irreversible?: { noul?: number };
      goal_done?: { noul?: number };
    };
  };
  if (!res.ok) throw new Error(`jev_http_${res.status}`);

  const a = json.answers || {};
  let action = (a.action?.choice || "WAIT") as DomAction;
  if (!ACTIONS.includes(action)) action = "WAIT";
  const targetRaw = a.target?.choice || "none";
  let targetId: number | null = null;
  if (targetRaw.startsWith("e")) {
    const n = Number(targetRaw.slice(1));
    if (Number.isFinite(n)) targetId = n;
  }
  const irreversible = Number(a.irreversible?.noul ?? 0);
  const goalDone = Number(a.goal_done?.noul ?? 0);

  // Do not abort on step-1 "already done" when Jev also picked a clickable target.
  // Premature DONE was stopping goals like "check my followers" on the X home feed.
  if (goalDone >= 0.92 && action === "DONE") {
    /* keep DONE */
  } else if (goalDone >= 0.92 && (action === "WAIT" || action === "BLOCKED")) {
    action = "DONE";
  } else if (action === "DONE" && targetId != null) {
    // Model contradicted itself — has a target, so click it instead of stopping.
    action = "CLICK";
  } else if (goalDone >= 0.85 && action === "DONE" && targetId != null) {
    action = "CLICK";
  }

  if ((input.step ?? 1) <= 1 && action === "DONE") {
    if (targetId != null) action = "CLICK";
    else action = "SCROLL_DOWN";
  }

  return {
    action,
    targetId,
    confidence: Number(a.action?.confidence ?? 0),
    done: action === "DONE",
    irreversible,
  };
}

export function extractQuotedText(goal: string): string | undefined {
  const m = goal.match(/"([^"]+)"|'([^']+)'/);
  return m?.[1] || m?.[2];
}
