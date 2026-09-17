import { DEFAULTS } from "./lib/defaults.js";

const API = "https://api.typesafe.ai/v1/systemone";

async function getSettings() {
  const stored = await chrome.storage.sync.get(null);
  return {
    ...DEFAULTS,
    ...stored,
    stats: { ...DEFAULTS.stats, ...(stored.stats || {}) },
  };
}

async function bumpStat(key) {
  const s = await getSettings();
  const stats = { ...s.stats, [key]: (s.stats?.[key] || 0) + 1 };
  await chrome.storage.sync.set({ stats });
}

function buildQuestions(sensitivity) {
  const tone =
    sensitivity === "paranoid"
      ? "Prefer block or ask when unsure. Money and irreversible actions are high risk."
      : sensitivity === "chill"
        ? "Only block clearly catastrophic actions. Prefer proceed for normal commerce the user initiated."
        : "Balance safety and friction. Ask when uncertain.";

  return {
    irreversible: {
      type: "noul",
      instructions:
        "Would this click permanently move money, delete data, send a message to others, or approve a production change?",
      criteria: {
        true: "Irreversible or hard to undo: payment, delete, send, deploy, transfer",
        false: "Reversible browsing or navigation with no lasting side effect",
      },
    },
    risk: {
      type: "score",
      instructions: `How dangerous is allowing this click right now? ${tone}`,
      criteria: [
        "Safe / reversible browsing",
        "Mild risk, easy undo",
        "Hard to undo, money or access at stake",
        "Catastrophic if wrong",
      ],
    },
    action: {
      type: "choice",
      instructions: `Decide what AskJev should do. ${tone}`,
      criteria: {
        proceed: "Allow the click. Low risk or clearly intentional.",
        block: "Hard block. Too dangerous or likely accidental.",
        ask: "Pause and make the human confirm in the overlay.",
      },
    },
  };
}

async function callJev({ state, apiKey, model, sensitivity }) {
  const body = {
    model: model || "jev-latest",
    state,
    questions: buildQuestions(sensitivity || "balanced"),
  };
  const res = await fetch(API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`bad_json_${res.status}`);
  }
  if (!res.ok) {
    const msg =
      json?.error?.message || json?.message || `http_${res.status}`;
    const err = new Error(String(msg));
    err.status = res.status;
    throw err;
  }
  return json;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "askjev.decide") {
    (async () => {
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
          state: msg.state,
          apiKey,
          model: settings.model,
          sensitivity: settings.sensitivity,
        });
        sendResponse({
          ok: true,
          result,
          settings: {
            sensitivity: settings.sensitivity,
            requireConfirmOnAsk: settings.requireConfirmOnAsk,
            showOverlayOnProceed: settings.showOverlayOnProceed,
          },
        });
      } catch (err) {
        await bumpStat("errors");
        sendResponse({
          ok: false,
          error: String(err?.message ?? err),
          status: err?.status,
        });
      }
    })();
    return true;
  }

  if (msg?.type === "askjev.stat") {
    bumpStat(msg.key).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg?.type === "askjev.getSettings") {
    getSettings().then((s) => {
      const { apiKey, ...rest } = s;
      sendResponse({
        ok: true,
        settings: { ...rest, hasKey: Boolean(apiKey && String(apiKey).trim()) },
      });
    });
    return true;
  }
});

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    const cur = await chrome.storage.sync.get(null);
    await chrome.storage.sync.set({ ...DEFAULTS, ...cur });
    chrome.runtime.openOptionsPage();
  }
});
