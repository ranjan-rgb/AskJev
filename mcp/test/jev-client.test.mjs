import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyAutopilotGuards,
  decideNextStep,
  parseDecision,
} from "../dist/jev-client.js";

const page = {
  goal: "open the pricing page",
  url: "https://example.com",
  title: "Example",
  step: 2,
  elements: [
    { id: 1, tag: "a", role: "link", name: "Pricing", href: "https://example.com/pricing" },
    { id: 2, tag: "button", role: "button", name: "Sign in" },
  ],
};

function okBody(answers) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    text: async () => JSON.stringify({ model: "jev-1.13.0", answers }),
  };
}

function errBody(status, headers = {}) {
  return {
    ok: false,
    status,
    headers: new Headers(headers),
    text: async () => JSON.stringify({ error: { message: `boom ${status}` } }),
  };
}

describe("applyAutopilotGuards", () => {
  it("honours DONE when Jev is confident the goal is met", () => {
    const r = applyAutopilotGuards({
      action: "DONE",
      targetId: null,
      goalDone: 0.97,
      step: 4,
    });
    assert.equal(r.action, "DONE");
    assert.equal(r.done, true);
  });

  it("promotes a stalled WAIT to DONE at high goal_done", () => {
    const r = applyAutopilotGuards({
      action: "WAIT",
      targetId: null,
      goalDone: 0.95,
      step: 3,
    });
    assert.equal(r.action, "DONE");
  });

  it("converts a premature DONE that still points at a control into CLICK", () => {
    const r = applyAutopilotGuards({
      action: "DONE",
      targetId: 7,
      goalDone: 0.4,
      step: 3,
    });
    assert.equal(r.action, "CLICK");
    assert.equal(r.done, false);
  });

  it("never finishes on step 1 from a landing page", () => {
    const withTarget = applyAutopilotGuards({
      action: "DONE",
      targetId: 3,
      goalDone: 0.5,
      step: 1,
    });
    assert.equal(withTarget.action, "CLICK");

    const noTarget = applyAutopilotGuards({
      action: "DONE",
      targetId: null,
      goalDone: 0.5,
      step: 1,
    });
    assert.equal(noTarget.action, "SCROLL_DOWN");
  });

  it("never finishes on step 1 even when goal_done is overwhelming", () => {
    // Step 1 is the freshly navigated page. A DONE here ends the run having
    // achieved nothing, which is the failure this rule exists to prevent — so
    // the step-1 rule outranks a high goal_done, and a named target (Jev
    // contradicting itself) is clicked rather than trusted.
    assert.equal(
      applyAutopilotGuards({
        action: "DONE",
        targetId: null,
        goalDone: 0.99,
        step: 1,
      }).action,
      "SCROLL_DOWN",
    );
    assert.equal(
      applyAutopilotGuards({
        action: "DONE",
        targetId: 7,
        goalDone: 0.99,
        step: 1,
      }).action,
      "CLICK",
    );
  });
});

describe("parseDecision", () => {
  it("reads choice, noul, score and probabilities", () => {
    const d = parseDecision(
      {
        answers: {
          action: {
            type: "choice",
            choice: "CLICK",
            confidence: 0.81,
            probabilities: { CLICK: 0.81, SCROLL_DOWN: 0.1 },
          },
          target: { type: "choice", choice: "e1" },
          irreversible: { type: "noul", noul: 0.02 },
          goal_done: { type: "noul", noul: 0.3 },
          progress: { type: "score", score: 2 },
        },
      },
      2,
    );
    assert.equal(d.action, "CLICK");
    assert.equal(d.targetId, 1);
    assert.equal(d.confidence, 0.81);
    assert.equal(d.progress, 2);
    assert.equal(d.probabilities.CLICK, 0.81);
  });

  it("falls back to WAIT on an unknown action and none target", () => {
    const d = parseDecision({ answers: { action: { choice: "TELEPORT" } } }, 3);
    assert.equal(d.action, "WAIT");
    assert.equal(d.targetId, null);
  });
});

describe("decideNextStep transport", () => {
  it("sends JSON state and structured criteria", async () => {
    let sent;
    await decideNextStep({
      apiKey: "k",
      page,
      fetchImpl: async (_url, init) => {
        sent = JSON.parse(init.body);
        return okBody({ action: { choice: "CLICK" }, target: { choice: "e1" } });
      },
    });
    assert.equal(typeof sent.state, "object", "state must be JSON, not a string");
    assert.equal(sent.state.goal, "open the pricing page");
    assert.equal(sent.state.page.url, "https://example.com");
    assert.equal(sent.state.elements[0].id, 1);
    assert.equal(sent.model, "jev-latest");
    assert.equal(typeof sent.questions.action.criteria.CLICK, "object");
    assert.equal(sent.questions.progress.type, "score");
    assert.equal(sent.questions.irreversible.criteria.true.length > 0, true);
  });

  it("retries 429 then succeeds", async () => {
    let calls = 0;
    const slept = [];
    const d = await decideNextStep({
      apiKey: "k",
      page,
      sleepImpl: async (ms) => void slept.push(ms),
      fetchImpl: async () => {
        calls++;
        if (calls === 1) return errBody(429, { "retry-after": "1" });
        return okBody({ action: { choice: "CLICK" }, target: { choice: "e1" } });
      },
    });
    assert.equal(calls, 2);
    assert.equal(slept[0], 1000, "honours Retry-After seconds");
    assert.equal(d.action, "CLICK");
  });

  it("retries 529 overloaded with backoff", async () => {
    let calls = 0;
    await decideNextStep({
      apiKey: "k",
      page,
      sleepImpl: async () => {},
      fetchImpl: async () => {
        calls++;
        if (calls < 3) return errBody(529);
        return okBody({ action: { choice: "WAIT" } });
      },
    });
    assert.equal(calls, 3);
  });

  it("does not retry 401 and reports it as unauthorized", async () => {
    let calls = 0;
    await assert.rejects(
      decideNextStep({
        apiKey: "bad",
        page,
        sleepImpl: async () => {},
        fetchImpl: async () => {
          calls++;
          return errBody(401);
        },
      }),
      (e) => e.code === "unauthorized",
    );
    assert.equal(calls, 1, "auth failures must fail loud, not retry");
  });

  it("does not retry 422", async () => {
    let calls = 0;
    await assert.rejects(
      decideNextStep({
        apiKey: "k",
        page,
        sleepImpl: async () => {},
        fetchImpl: async () => {
          calls++;
          return errBody(422);
        },
      }),
      (e) => e.code === "invalid_params",
    );
    assert.equal(calls, 1);
  });

  it("gives up after maxRetries and surfaces rate_limited", async () => {
    let calls = 0;
    await assert.rejects(
      decideNextStep({
        apiKey: "k",
        page,
        maxRetries: 1,
        sleepImpl: async () => {},
        fetchImpl: async () => {
          calls++;
          return errBody(429);
        },
      }),
      (e) => e.code === "rate_limited",
    );
    assert.equal(calls, 2);
  });

  it("caps elements offered as targets", async () => {
    let sent;
    const many = Array.from({ length: 200 }, (_, i) => ({
      id: i + 1,
      tag: "button",
      role: "button",
      name: `b${i}`,
    }));
    await decideNextStep({
      apiKey: "k",
      page: { ...page, elements: many },
      fetchImpl: async (_url, init) => {
        sent = JSON.parse(init.body);
        return okBody({ action: { choice: "WAIT" } });
      },
    });
    const targetKeys = Object.keys(sent.questions.target.criteria);
    assert.equal(targetKeys.length, 61, "60 elements + none");
    assert.equal(
      sent.state.elements.length,
      60,
      "state and target list must agree",
    );
  });
});
