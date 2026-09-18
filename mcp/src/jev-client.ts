/**
 * TypeSafe System One client for AskJev MCP autopilot.
 * Decisions use Noul / Choice / Score — not a Claude LLM planner.
 *
 * Follows the TypeSafe docs:
 *   - state is passed as JSON, not a flattened string (concepts/state)
 *   - criteria use structured objects to sharpen boundaries (primitives/advanced)
 *   - one fan-out call carries every question (patterns/fan-out)
 *   - confidence is a routing axis, not a log line (patterns/confidence-routing)
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BridgeError } from "./errors.js";

export const SYSTEM_ONE_URL = "https://api.typesafe.ai/v1/systemone";

/** Jev 1.13 allows 32k tokens of state; stay well under it. */
export const MAX_TARGET_ELEMENTS = 60;

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
  /** Jev's confidence in the chosen action (0–1). */
  confidence: number;
  done: boolean;
  irreversible: number;
  goalDone: number;
  /** 0–3 rubric score: how much this step advances the goal. */
  progress: number;
  /** Full action distribution — used for oscillation and tie detection. */
  probabilities: Record<string, number>;
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
  return new BridgeError(
    "missing_api_key",
    "AskJev needs a TypeSafe API key for multi-step goals. " +
      "Add TypeSafe API key in AskJev Options, then Auto-connect (or write ~/.askjev/api-key). " +
      "Get a key at https://typesafe.ai — then quit & reopen Claude.",
  );
}

/**
 * Post-process raw Jev Choice answers so multi-step goals do not stop early.
 * Ordered most-specific first — each branch is reachable.
 */
export function applyAutopilotGuards(input: {
  action: AutopilotAction;
  targetId: number | null;
  goalDone: number;
  /** 1-based autopilot step — blocks premature DONE on step 1. */
  step?: number;
}): { action: AutopilotAction; done: boolean } {
  let action = input.action;
  const { targetId, goalDone } = input;
  const step = input.step ?? 1;

  // Jev is sure the goal is met — honour DONE, and treat a stall as DONE too.
  if (goalDone >= 0.92) {
    if (action === "WAIT" || action === "BLOCKED") action = "DONE";
  } else if (action === "DONE" && targetId != null) {
    // Claims done but still points at a control — the control is the real next step.
    action = "CLICK";
  }

  // A landing page is never "done" on the first look.
  if (step <= 1 && action === "DONE" && goalDone < 0.92) {
    action = targetId != null ? "CLICK" : "SCROLL_DOWN";
  }

  return { action, done: action === "DONE" };
}

export function extractQuotedText(goal: string): string | undefined {
  const m = goal.match(/"([^"]+)"|'([^']+)'/);
  return m?.[1] || m?.[2];
}

type SystemOneAnswers = {
  action?: {
    choice?: string;
    confidence?: number;
    probabilities?: Record<string, number>;
    type?: string;
  };
  target?: { choice?: string; confidence?: number; type?: string };
  irreversible?: { noul?: number; type?: string };
  goal_done?: { noul?: number; type?: string };
  progress?: { score?: number; confidence?: number; type?: string };
};

function parseAnswers(json: unknown): SystemOneAnswers {
  if (typeof json !== "object" || json === null) return {};
  const answers = (json as { answers?: unknown }).answers;
  if (typeof answers !== "object" || answers === null) return {};
  return answers as SystemOneAnswers;
}

/**
 * Map System One HTTP failures onto AskJev's structured codes.
 * Documented statuses: 401 auth, 422 validation, 429 rate limit, 529 overloaded.
 */
function systemOneError(status: number, message: string): BridgeError {
  if (status === 401) {
    return new BridgeError(
      "unauthorized",
      `TypeSafe rejected the API key (401). Re-check the key in AskJev Options, then Auto-connect again. ${message}`,
    );
  }
  if (status === 422) {
    return new BridgeError(
      "invalid_params",
      `TypeSafe could not process the request (422): ${message}`,
    );
  }
  if (status === 429) {
    return new BridgeError(
      "rate_limited",
      `TypeSafe rate limit hit (429): ${message}`,
    );
  }
  if (status === 529) {
    return new BridgeError(
      "internal",
      `TypeSafe is overloaded (529): ${message}`,
    );
  }
  return new BridgeError("internal", `jev_http_${status}: ${message}`);
}

/** 429 and 529 are transient — everything else fails immediately. */
function isRetryable(status: number): boolean {
  return status === 429 || status === 529;
}

/**
 * Structured page state. Jev reads JSON directly, so we do not flatten to a
 * string — labelled keys carry more signal than a newline blob.
 */
export interface PageState {
  goal: string;
  url: string;
  title: string;
  step: number;
  /** Recent action log so Jev can see it is repeating itself. */
  history?: string[];
  elements: SnapshotElement[];
}

function buildState(input: PageState): Record<string, unknown> {
  return {
    goal: input.goal,
    page: { url: input.url, title: input.title },
    step: input.step,
    recent_actions: input.history?.slice(-6) ?? [],
    elements: input.elements.slice(0, MAX_TARGET_ELEMENTS).map((e) => ({
      id: e.id,
      role: e.role,
      name: e.name,
      ...(e.type ? { input_type: e.type } : {}),
      ...(e.href ? { href: e.href } : {}),
      ...(e.value ? { current_value: e.value } : {}),
    })),
  };
}

const ACTION_CRITERIA: Record<string, Record<string, string>> = {
  CLICK: {
    what: "Click one visible control that moves the goal forward",
    not_for: "Anything that needs typed input first",
    examples: "Open a menu, follow a link, submit a completed form",
  },
  TYPE_TEXT: {
    what: "Type into a text input, textarea, or contenteditable field",
    not_for: "Buttons and links",
    examples: "Fill a search box, enter an email address",
  },
  SELECT: {
    what: "Choose an option from a dropdown or select element",
    not_for: "Free-text fields",
    examples: "Pick a country, choose a sort order",
  },
  SCROLL_DOWN: {
    what: "Scroll down because the needed control is probably below the fold",
    not_for: "When a matching control is already listed in elements",
    examples: "Long feeds, lazy-loaded lists, footers",
  },
  SCROLL_UP: {
    what: "Scroll up to reach a control above the current viewport",
    not_for: "First look at a freshly loaded page",
    examples: "Return to a header nav after scrolling",
  },
  WAIT: {
    what: "Pause one beat because the page is still loading or transitioning",
    not_for: "A settled page with usable controls",
    examples: "Spinner visible, element list looks empty mid-navigation",
  },
  DONE: {
    what: "The goal is fully satisfied by what is on screen right now",
    not_for:
      "A landing page, home feed, or generic profile that merely leads toward the goal",
    examples: "The requested list, record, or confirmation is visible",
  },
  BLOCKED: {
    what: "Cannot proceed safely or the page is genuinely stuck",
    not_for: "Merely needing another ordinary click or scroll",
    examples: "Login wall with no credentials, hard error page, captcha",
  },
};

/** Fan-out atomic Noul/Choice/Score for the next browser step in one call. */
export async function decideNextStep(input: {
  apiKey: string;
  page: PageState;
  model?: string;
  fetchImpl?: typeof fetch;
  /** Per-attempt network timeout. */
  timeoutMs?: number;
  /** Transient-failure retries (429/529). */
  maxRetries?: number;
  sleepImpl?: (ms: number) => Promise<void>;
}): Promise<AutopilotDecision> {
  const targets = input.page.elements.slice(0, MAX_TARGET_ELEMENTS);
  const targetCriteria: Record<string, string> = {
    none: "No element needed — for SCROLL_DOWN, SCROLL_UP, WAIT, DONE, BLOCKED",
  };
  for (const e of targets) {
    targetCriteria[`e${e.id}`] =
      `${e.role} "${e.name || e.value || e.href || e.type || "unlabelled"}"`;
  }

  const body = {
    model: input.model || "jev-latest",
    state: buildState(input.page),
    questions: {
      action: {
        type: "choice" as const,
        instructions:
          "Pick the single next browser action that best advances the user goal from the current page. " +
          "Choose DONE only when the goal's destination content is already visible in elements or title. " +
          "Choose BLOCKED only when no ordinary click, type, or scroll could make progress.",
        criteria: ACTION_CRITERIA,
      },
      target: {
        type: "choice" as const,
        instructions:
          "Pick the element id to act on for CLICK, TYPE_TEXT, or SELECT. Use none for every other action.",
        criteria: targetCriteria,
      },
      irreversible: {
        type: "noul" as const,
        instructions:
          "Would executing this next action cause a lasting, hard-to-undo effect?",
        criteria: {
          true: "Moves money, deletes data, sends or publishes a message, deploys, grants or revokes access, or changes security settings",
          false:
            "Ordinary browsing, navigation, searching, scrolling, or filling a field that is not yet submitted",
        },
      },
      goal_done: {
        type: "noul" as const,
        instructions:
          "Is the user goal already fully satisfied by what is visible on this page?",
        criteria: {
          true: "The specific destination content the goal asked for is on screen now",
          false:
            "Only a landing page, home feed, search box, or intermediate step toward the goal is visible",
        },
      },
      progress: {
        type: "score" as const,
        instructions:
          "How much does the chosen next action advance the user goal?",
        criteria: [
          { summary: "Wrong direction", signals: "Leaves the task or repeats a step that already failed" },
          { summary: "Neutral", signals: "Scroll or wait that may or may not reveal the target" },
          { summary: "Real progress", signals: "Moves to the next required screen or fills a required field" },
          { summary: "Completes the goal", signals: "This action reaches the goal's destination" },
        ],
      },
    },
  };

  const fetchImpl = input.fetchImpl ?? fetch;
  const sleep =
    input.sleepImpl ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const maxRetries = input.maxRetries ?? 2;
  const timeoutMs = input.timeoutMs ?? 15_000;

  let lastErr: BridgeError | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(SYSTEM_ONE_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.apiKey.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      const aborted = e instanceof Error && e.name === "AbortError";
      lastErr = aborted
        ? new BridgeError("timeout", `Jev did not answer in ${timeoutMs}ms`)
        : new BridgeError(
            "internal",
            `Could not reach TypeSafe: ${e instanceof Error ? e.message : String(e)}`,
          );
      if (attempt < maxRetries) {
        await sleep(400 * 2 ** attempt);
        continue;
      }
      throw lastErr;
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = null;
    }

    if (!res.ok) {
      const msg =
        typeof json === "object" &&
        json !== null &&
        "error" in json &&
        typeof (json as { error?: { message?: unknown } }).error?.message ===
          "string"
          ? (json as { error: { message: string } }).error.message
          : text.slice(0, 200) || `status ${res.status}`;
      lastErr = systemOneError(res.status, msg);
      if (isRetryable(res.status) && attempt < maxRetries) {
        const retryAfter = Number(res.headers?.get?.("retry-after") ?? NaN);
        const waitMs = Number.isFinite(retryAfter)
          ? Math.min(retryAfter * 1000, 10_000)
          : 400 * 2 ** attempt;
        await sleep(waitMs);
        continue;
      }
      throw lastErr;
    }

    if (json === null) {
      throw new BridgeError(
        "internal",
        `TypeSafe returned unreadable JSON (status ${res.status})`,
      );
    }

    return parseDecision(json, input.page.step);
  }

  throw lastErr ?? new BridgeError("internal", "Jev request failed");
}

/** Turn a raw System One body into a guarded decision. Exported for tests. */
export function parseDecision(json: unknown, step = 1): AutopilotDecision {
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
  const progress = Number(a.progress?.score ?? 0);

  const guarded = applyAutopilotGuards({ action, targetId, goalDone, step });

  return {
    action: guarded.action,
    targetId,
    confidence: Number(a.action?.confidence ?? 0),
    done: guarded.done,
    irreversible,
    goalDone,
    progress,
    probabilities: a.action?.probabilities ?? {},
  };
}
