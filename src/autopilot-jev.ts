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
          "Pick the single next browser action to advance the user goal. Prefer DONE when finished. Prefer BLOCKED if unsafe or impossible.",
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
        instructions: "Is the user goal already satisfied on this page?",
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
  if (goalDone >= 0.85) action = "DONE";

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
