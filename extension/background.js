// src/defaults.ts
var DEFAULTS = {
  enabled: true,
  sensitivity: "balanced",
  customKeywords: [],
  allowlist: [],
  requireConfirmOnAsk: true,
  showOverlayOnProceed: false,
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
      instructions: "Would this click permanently move money, delete data, send a message to others, or approve a production change?",
      criteria: {
        true: "Irreversible or hard to undo: payment, delete, send, deploy, transfer",
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
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    void (async () => {
      const cur = await chrome.storage.sync.get(null);
      await chrome.storage.sync.set({ ...DEFAULTS, ...cur });
      chrome.runtime.openOptionsPage();
    })();
  }
});
//# sourceMappingURL=background.js.map
