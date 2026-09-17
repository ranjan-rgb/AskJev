// src/defaults.ts
var DEFAULTS = {
  enabled: true,
  sensitivity: "balanced",
  customKeywords: [],
  allowlist: [],
  requireConfirmOnAsk: true,
  showOverlayOnProceed: false,
  gateFormSubmits: false,
  model: "jev-latest",
  stats: { blocked: 0, asked: 0, proceeded: 0, errors: 0 }
};

// src/jev.ts
var SYSTEM_ONE_URL = "https://api.typesafe.ai/v1/systemone";
function buildQuestions(sensitivity) {
  const tone = sensitivity === "paranoid" ? "Prefer block or ask when unsure. Money and irreversible actions are high risk." : sensitivity === "chill" ? "Only block clearly catastrophic actions. Prefer proceed for normal commerce the user initiated." : "Balance safety and friction. Ask when uncertain.";
  return {
    irreversible: {
      type: "noul",
      instructions: "Would this click cause a lasting or hard-to-undo effect on any website \u2014 money movement, data loss, sending a message, granting access, publishing, deploying, or changing account/security settings?",
      criteria: {
        true: "Hard to undo on any site: pay, delete, send, publish, deploy, revoke, grant access, transfer",
        false: "Reversible browsing or navigation with no lasting side effect"
      }
    },
    risk: {
      type: "score",
      instructions: `How dangerous is allowing this click right now? ${tone}`,
      criteria: [
        "Safe / reversible browsing",
        "Mild risk, easy undo",
        "Hard to undo, money or access at stake",
        "Catastrophic if wrong"
      ]
    },
    action: {
      type: "choice",
      instructions: `Decide what AskJev should do. ${tone}`,
      criteria: {
        proceed: "Allow the click. Low risk or clearly intentional.",
        block: "Hard block. Too dangerous or likely accidental.",
        ask: "Pause and make the human confirm in the overlay."
      }
    }
  };
}
async function callJev(input) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const body = {
    model: input.model || "jev-latest",
    state: input.state,
    questions: buildQuestions(input.sensitivity)
  };
  const res = await fetchImpl(SYSTEM_ONE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey.trim()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`bad_json_${res.status}`);
  }
  if (!res.ok) {
    const msg = typeof json === "object" && json !== null && "error" in json && typeof json.error?.message === "string" ? json.error.message : `http_${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return json;
}

// src/autopilot-jev.ts
var ACTIONS = [
  "CLICK",
  "TYPE_TEXT",
  "SELECT",
  "SCROLL_DOWN",
  "SCROLL_UP",
  "WAIT",
  "DONE",
  "BLOCKED"
];
async function decideNextStep(input) {
  const criteria = {
    CLICK: "Click a visible control to progress the goal",
    TYPE_TEXT: "Type text into an input/textarea (text comes from goal quotes or sidepanel)",
    SELECT: "Choose from a dropdown",
    SCROLL_DOWN: "Scroll down to reveal more",
    SCROLL_UP: "Scroll up",
    WAIT: "Wait for page to settle",
    DONE: "Goal is complete \u2014 stop",
    BLOCKED: "Cannot proceed safely or page is stuck"
  };
  const targets = input.elements.slice(0, 60);
  const targetCriteria = { none: "No element needed (scroll/wait/done/blocked)" };
  for (const e of targets) {
    targetCriteria[`e${e.id}`] = `#${e.id} ${e.tag} "${e.name || e.value || e.href || e.type}"`;
  }
  const body = {
    model: input.model || "jev-latest",
    state: input.state,
    questions: {
      action: {
        type: "choice",
        instructions: "Pick the single next browser action to advance the user goal. Prefer DONE when finished. Prefer BLOCKED if unsafe or impossible.",
        criteria
      },
      target: {
        type: "choice",
        instructions: "Pick the element id for CLICK/TYPE_TEXT/SELECT. Use none for scroll/wait/done/blocked.",
        criteria: targetCriteria
      },
      irreversible: {
        type: "noul",
        instructions: "Would executing this next action cause lasting harm (pay, delete, send, publish, deploy, revoke, grant access)?"
      },
      goal_done: {
        type: "noul",
        instructions: "Is the user goal already satisfied on this page?"
      }
    }
  };
  const res = await fetch(SYSTEM_ONE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey.trim()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`jev_http_${res.status}`);
  const a = json.answers || {};
  let action = a.action?.choice || "WAIT";
  if (!ACTIONS.includes(action)) action = "WAIT";
  const targetRaw = a.target?.choice || "none";
  let targetId = null;
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
    irreversible
  };
}
function extractQuotedText(goal) {
  const m = goal.match(/"([^"]+)"|'([^']+)'/);
  return m?.[1] || m?.[2];
}

// src/background.ts
async function getSettings() {
  const stored = await chrome.storage.sync.get(null);
  return {
    ...DEFAULTS,
    ...stored,
    stats: { ...DEFAULTS.stats, ...stored.stats || {} }
  };
}
async function bumpStat(key) {
  const s = await getSettings();
  const stats = { ...s.stats, [key]: (s.stats?.[key] || 0) + 1 };
  await chrome.storage.sync.set({ stats });
}
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "askjev.decide") {
    void (async () => {
      try {
        const settings = await getSettings();
        if (!settings.enabled) {
          sendResponse({ ok: true, bypass: true, reason: "disabled" });
          return;
        }
        const apiKey = settings.apiKey;
        if (!apiKey || !String(apiKey).trim()) {
          sendResponse({ ok: false, error: "missing_api_key" });
          return;
        }
        const result = await callJev({
          state: String(msg.state ?? ""),
          apiKey,
          model: settings.model,
          sensitivity: settings.sensitivity
        });
        sendResponse({
          ok: true,
          result,
          settings: {
            sensitivity: settings.sensitivity,
            requireConfirmOnAsk: settings.requireConfirmOnAsk,
            showOverlayOnProceed: settings.showOverlayOnProceed
          }
        });
      } catch (err) {
        await bumpStat("errors");
        const e = err;
        sendResponse({
          ok: false,
          error: String(e?.message ?? err),
          status: e?.status
        });
      }
    })();
    return true;
  }
  if (msg?.type === "askjev.stat") {
    void bumpStat(msg.key).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === "askjev.getSettings") {
    void getSettings().then((s) => {
      const { apiKey, ...rest } = s;
      sendResponse({
        ok: true,
        settings: { ...rest, hasKey: Boolean(apiKey && String(apiKey).trim()) }
      });
    });
    return true;
  }
  return void 0;
});
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => void 0);
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    void (async () => {
      const cur = await chrome.storage.sync.get(null);
      await chrome.storage.sync.set({ ...DEFAULTS, ...cur });
      chrome.runtime.openOptionsPage();
    })();
  }
});
var autopilotRunning = false;
async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id;
}
function broadcast(msg) {
  void chrome.runtime.sendMessage(msg).catch(() => void 0);
}
async function runAutopilot(goal, typeText) {
  const settings = await getSettings();
  if (!settings.apiKey?.trim()) {
    broadcast({
      type: "askjev.autopilot.status",
      status: "missing TypeSafe API key \u2014 open Options"
    });
    return;
  }
  autopilotRunning = true;
  const maxSteps = 20;
  for (let step = 1; step <= maxSteps && autopilotRunning; step++) {
    const tabId = await getActiveTabId();
    if (tabId == null) {
      broadcast({ type: "askjev.autopilot.status", status: "no active tab" });
      break;
    }
    broadcast({
      type: "askjev.autopilot.log",
      line: `step ${step}: snapshot`
    });
    const snap = await chrome.tabs.sendMessage(tabId, {
      type: "askjev.dom.snapshot",
      goal
    });
    if (!snap?.ok) {
      broadcast({
        type: "askjev.autopilot.log",
        line: `snapshot failed: ${snap?.error || "unknown"}`
      });
      break;
    }
    let decision;
    try {
      decision = await decideNextStep({
        apiKey: settings.apiKey,
        state: snap.state,
        elements: snap.elements,
        model: settings.model
      });
    } catch (e) {
      await bumpStat("errors");
      broadcast({
        type: "askjev.autopilot.log",
        line: `jev error: ${e.message}`
      });
      break;
    }
    broadcast({
      type: "askjev.autopilot.log",
      line: `jev \u2192 ${decision.action} target=${decision.targetId ?? "none"} irr=${decision.irreversible.toFixed(2)}`
    });
    if (decision.done || decision.action === "DONE") {
      broadcast({ type: "askjev.autopilot.status", status: "done" });
      await bumpStat("proceeded");
      break;
    }
    if (decision.action === "BLOCKED") {
      broadcast({ type: "askjev.autopilot.status", status: "blocked by jev" });
      await bumpStat("blocked");
      break;
    }
    if (decision.irreversible >= 0.65) {
      broadcast({
        type: "askjev.autopilot.status",
        status: `guard: irreversible (${decision.irreversible.toFixed(2)}) \u2014 stopped. Use Guard overlay or lower risk goal.`
      });
      await bumpStat("blocked");
      break;
    }
    const text = typeText || extractQuotedText(goal) || void 0;
    const exec = await chrome.tabs.sendMessage(tabId, {
      type: "askjev.dom.execute",
      action: decision.action,
      targetId: decision.targetId,
      text
    });
    broadcast({
      type: "askjev.autopilot.log",
      line: exec?.detail || "executed"
    });
    await new Promise((r) => setTimeout(r, 700));
  }
  autopilotRunning = false;
  broadcast({ type: "askjev.autopilot.status", status: "idle" });
}
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "askjev.autopilot.start") {
    void runAutopilot(String(msg.goal || ""), msg.typeText);
    sendResponse({ ok: true });
    return true;
  }
  if (msg?.type === "askjev.autopilot.stop") {
    autopilotRunning = false;
    sendResponse({ ok: true });
    return true;
  }
  return void 0;
});
//# sourceMappingURL=background.js.map
