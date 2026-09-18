import type { Sensitivity } from "./defaults.js";

export const SYSTEM_ONE_URL = "https://api.typesafe.ai/v1/systemone";

export interface NoulAnswer {
  type: "noul";
  noul: number;
}

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities?: Record<string, number>;
  confidence?: number;
}

export interface ScoreAnswer {
  type: "score";
  score: number;
  legend?: Record<string, string>;
  probabilities?: Record<string, number>;
  confidence?: number;
}

export interface SystemOneResult {
  model: string;
  answers: {
    irreversible?: NoulAnswer;
    risk?: ScoreAnswer;
    action?: ChoiceAnswer;
  };
  usage?: { input_tokens: number; output_tokens: number };
}

function buildQuestions(sensitivity: Sensitivity) {
  const tone =
    sensitivity === "paranoid"
      ? "Prefer block or ask when unsure. Money and irreversible actions are high risk."
      : sensitivity === "chill"
        ? "Only block clearly catastrophic actions. Prefer proceed for normal commerce the user initiated."
        : "Balance safety and friction. Ask when uncertain.";

  return {
    irreversible: {
      type: "noul" as const,
      instructions:
        "Would this click cause a lasting or hard-to-undo effect on any website — money movement, data loss, sending a message, granting access, publishing, deploying, or changing account/security settings?",
      criteria: {
        true: "Hard to undo on any site: pay, delete, send, publish, deploy, revoke, grant access, transfer, or end the session — sign out, log out, switch account, disconnect an app, clear history or site data",
        false: "Reversible browsing or navigation with no lasting side effect",
      },
    },
    risk: {
      type: "score" as const,
      instructions: `How dangerous is allowing this click right now? ${tone}`,
      criteria: [
        "Safe / reversible browsing",
        "Mild risk, easy undo",
        "Hard to undo, money or access at stake",
        "Catastrophic if wrong",
      ],
    },
    action: {
      type: "choice" as const,
      instructions: `Decide what AskJev should do. ${tone}`,
      criteria: {
        proceed: "Allow the click. Low risk or clearly intentional.",
        block: "Hard block. Too dangerous or likely accidental.",
        ask: "Pause and make the human confirm in the overlay.",
      },
    },
  };
}

export async function callJev(input: {
  state: string;
  apiKey: string;
  model: string;
  sensitivity: Sensitivity;
  fetchImpl?: typeof fetch;
}): Promise<SystemOneResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const body = {
    model: input.model || "jev-latest",
    state: input.state,
    questions: buildQuestions(input.sensitivity),
  };
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
    throw new Error(`bad_json_${res.status}`);
  }
  if (!res.ok) {
    const msg =
      typeof json === "object" &&
      json !== null &&
      "error" in json &&
      typeof (json as { error?: { message?: unknown } }).error?.message ===
        "string"
        ? (json as { error: { message: string } }).error.message
        : `http_${res.status}`;
    const err = new Error(msg) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return json as SystemOneResult;
}
