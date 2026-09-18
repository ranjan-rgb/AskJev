/**
 * TypeSafe System One client for AskJev MCP autopilot.
 * Decisions use Noul / Choice / Score — not a Claude LLM planner.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const SYSTEM_ONE_URL = "https://api.typesafe.ai/v1/systemone";

export type AutopilotAction =
  | "CLICK"
  | "TYPE_TEXT"
  | "SELECT"
  | "SCROLL_DOWN"
  | "SCROLL_UP"
  | "WAIT"
  | "DONE"
  | "BLOCKED";

export interface SnapshotElement {
  id: number;
  tag: string;
  role: string;
  name: string;
  type?: string;
  href?: string;
  value?: string;
}

export interface AutopilotDecision {
  action: AutopilotAction;
  targetId: number | null;
  confidence: number;
  done: boolean;
  irreversible: number;
  goalDone: number;
}

const ACTIONS: AutopilotAction[] = [
  "CLICK",
  "TYPE_TEXT",
  "SELECT",
  "SCROLL_DOWN",
  "SCROLL_UP",
  "WAIT",
  "DONE",
  "BLOCKED",
];

/** Read ~/.askjev/api-key if present (written by Auto-connect merge script). */
function readAskjevApiKeyFile(): string | null {
  try {
    const p = join(homedir(), ".askjev", "api-key");
    if (!existsSync(p)) return null;
    const k = readFileSync(p, "utf8").trim();
    return k || null;
  } catch {
    return null;
  }
}

/** Resolve TypeSafe / AskJev API key from env or ~/.askjev/api-key (never log the value). */
export function resolveApiKey(): string | null {
  const k = (
    process.env.ASKJEV_API_KEY ||
    process.env.TYPESAFE_API_KEY ||
    ""
  ).trim();
  if (k) return k;
  return readAskjevApiKeyFile();
}

export function missingApiKeyError(): Error {
  return new Error(
    "AskJev needs a TypeSafe API key for multi-step goals. " +
      "Add TypeSafe API key in AskJev Options, then Auto-connect (or write ~/.askjev/api-key). " +
      "Get a key at https://typesafe.ai — then quit & reopen Claude.",
  );
}

/**
 * Post-process raw Jev Choice answers so multi-step goals do not stop early.
 * Port of extension applyAutopilotGuards.
 */
export function applyAutopilotGuards(input: {
  action: AutopilotAction;
  targetId: number | null;
  goalDone: number;
  /** 1-based autopilot step — blocks premature DONE on step 1. */
  step?: number;
}): { action: AutopilotAction; done: boolean } {
  let action = input.action;
  const targetId = input.targetId;
  const goalDone = input.goalDone;

  if (goalDone >= 0.92 && action === "DONE") {
    /* keep DONE */
  } else if (goalDone >= 0.92 && (action === "WAIT" || action === "BLOCKED")) {
    action = "DONE";
  } else if (action === "DONE" && targetId != null) {
    action = "CLICK";
  } else if (goalDone >= 0.85 && action === "DONE" && targetId != null) {
    action = "CLICK";
  }

  if ((input.step ?? 1) <= 1 && action === "DONE") {
    if (targetId != null) action = "CLICK";
    else action = "SCROLL_DOWN";
  }

  return { action, done: action === "DONE" };
}

export function extractQuotedText(goal: string): string | undefined {
  const m = goal.match(/"([^"]+)"|'([^']+)'/);
  return m?.[1] || m?.[2];
}

type SystemOneAnswers = {
  action?: { choice?: string; confidence?: number; type?: string };
  target?: { choice?: string; confidence?: number; type?: string };
  irreversible?: { noul?: number; type?: string };
  goal_done?: { noul?: number; type?: string };
};

function parseAnswers(json: unknown): SystemOneAnswers {
  if (typeof json !== "object" || json === null) return {};
  const answers = (json as { answers?: unknown }).answers;
  if (typeof answers !== "object" || answers === null) return {};
  return answers as SystemOneAnswers;
}

/** Fan-out atomic Noul/Choice for next browser step. */
export async function decideNextStep(input: {
  apiKey: string;
  state: string;
  elements: SnapshotElement[];
  model?: string;
  /** 1-based autopilot step — used to block premature DONE on step 1. */
  step?: number;
  fetchImpl?: typeof fetch;
}): Promise<AutopilotDecision> {
  const criteria: Record<string, string> = {
    CLICK: "Click a visible control to progress the goal",
    TYPE_TEXT:
      "Type text into an input/textarea (text comes from goal quotes or typeText)",
    SELECT: "Choose from a dropdown",
    SCROLL_DOWN: "Scroll down to reveal more",
    SCROLL_UP: "Scroll up",
    WAIT: "Wait for page to settle",
    DONE: "Goal is complete — stop",
    BLOCKED: "Cannot proceed safely or page is stuck",
  };

  const targets = input.elements.slice(0, 60);
  const targetCriteria: Record<string, string> = {
    none: "No element needed (scroll/wait/done/blocked)",
  };
  for (const e of targets) {
    targetCriteria[`e${e.id}`] =
      `#${e.id} ${e.tag} "${e.name || e.value || e.href || e.type || ""}"`;
  }

  const body = {
    model: input.model || "jev-latest",
    state: input.state,
    questions: {
      action: {
        type: "choice" as const,
        instructions:
          "Pick the single next browser action to advance the user goal. Only choose DONE if the goal is visibly complete on this page (e.g. the followers list is already open and readable). Being on a home/feed/profile landing page is NOT done — click the Followers/Profile control next. Prefer BLOCKED if unsafe or impossible.",
        criteria,
      },
      target: {
        type: "choice" as const,
        instructions:
          "Pick the element id for CLICK/TYPE_TEXT/SELECT. Use none for scroll/wait/done/blocked.",
        criteria: targetCriteria,
      },
      irreversible: {
        type: "noul" as const,
        instructions:
          "Would executing this next action cause lasting harm (pay, delete, send, publish, deploy, revoke, grant access)?",
      },
      goal_done: {
        type: "noul" as const,
        instructions:
          "Is the user goal FULLY satisfied by what is already visible? Answer low unless the exact destination UI is on screen (e.g. followers list visible). Home feeds and generic profiles are not enough.",
      },
    },
  };

  const fetchImpl = input.fetchImpl ?? fetch;
  const res = await fetchImpl(SYSTEM_ONE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`jev_bad_json_${res.status}`);
  }
  if (!res.ok) {
    const msg =
      typeof json === "object" &&
      json !== null &&
      "error" in json &&
      typeof (json as { error?: { message?: unknown } }).error?.message ===
        "string"
        ? (json as { error: { message: string } }).error.message
        : `jev_http_${res.status}`;
    const err = new Error(msg) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  const a = parseAnswers(json);
  let action = (a.action?.choice || "WAIT") as AutopilotAction;
  if (!ACTIONS.includes(action)) action = "WAIT";
  const targetRaw = a.target?.choice || "none";
  let targetId: number | null = null;
  if (targetRaw.startsWith("e")) {
    const n = Number(targetRaw.slice(1));
    if (Number.isFinite(n)) targetId = n;
  }
  const irreversible = Number(a.irreversible?.noul ?? 0);
  const goalDone = Number(a.goal_done?.noul ?? 0);

  const guarded = applyAutopilotGuards({
    action,
    targetId,
    goalDone,
    step: input.step,
  });

  return {
    action: guarded.action,
    targetId,
    confidence: Number(a.action?.confidence ?? 0),
    done: guarded.done,
    irreversible,
    goalDone,
  };
}
