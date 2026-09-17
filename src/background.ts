import { DEFAULTS, type AskJevSettings } from "./defaults.js";
import { callJev } from "./jev.js";
import { decideNextStep, extractQuotedText } from "./autopilot-jev.js";

async function getSettings(): Promise<AskJevSettings> {
  const stored = (await chrome.storage.sync.get(null)) as Partial<AskJevSettings>;
  return {
    ...DEFAULTS,
    ...stored,
    stats: { ...DEFAULTS.stats, ...(stored.stats || {}) },
  };
}

async function bumpStat(key: keyof AskJevSettings["stats"]): Promise<void> {
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
        const e = err as Error & { status?: number };
        sendResponse({
          ok: false,
          error: String(e?.message ?? err),
          status: e?.status,
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
        settings: { ...rest, hasKey: Boolean(apiKey && String(apiKey).trim()) },
      });
    });
    return true;
  }
  return undefined;
});

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: false })
  .catch(() => undefined);

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    void (async () => {
      const cur = await chrome.storage.sync.get(null);
      await chrome.storage.sync.set({ ...DEFAULTS, ...cur });
      chrome.runtime.openOptionsPage();
    })();
  }
});

/** ---- Autopilot ---- */
let autopilotRunning = false;

async function getActiveTabId(): Promise<number | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id;
}

function broadcast(msg: object): void {
  void chrome.runtime.sendMessage(msg).catch(() => undefined);
}

async function runAutopilot(goal: string, typeText?: string): Promise<void> {
  const settings = await getSettings();
  if (!settings.apiKey?.trim()) {
    broadcast({
      type: "askjev.autopilot.status",
      status: "missing TypeSafe API key — open Options",
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
      line: `step ${step}: snapshot`,
    });
    const snap = await chrome.tabs.sendMessage(tabId, {
      type: "askjev.dom.snapshot",
      goal,
    });
    if (!snap?.ok) {
      broadcast({
        type: "askjev.autopilot.log",
        line: `snapshot failed: ${snap?.error || "unknown"}`,
      });
      break;
    }

    let decision;
    try {
      decision = await decideNextStep({
        apiKey: settings.apiKey,
        state: snap.state,
        elements: snap.elements,
        model: settings.model,
      });
    } catch (e) {
      await bumpStat("errors");
      broadcast({
        type: "askjev.autopilot.log",
        line: `jev error: ${(e as Error).message}`,
      });
      break;
    }

    broadcast({
      type: "askjev.autopilot.log",
      line: `jev → ${decision.action} target=${decision.targetId ?? "none"} irr=${decision.irreversible.toFixed(2)}`,
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

    // Guard: irreversible actions need explicit confirm via sidepanel status
    if (decision.irreversible >= 0.65) {
      broadcast({
        type: "askjev.autopilot.status",
        status: `guard: irreversible (${decision.irreversible.toFixed(2)}) — stopped. Use Guard overlay or lower risk goal.`,
      });
      await bumpStat("blocked");
      break;
    }

    const text =
      typeText ||
      extractQuotedText(goal) ||
      undefined;
    const exec = await chrome.tabs.sendMessage(tabId, {
      type: "askjev.dom.execute",
      action: decision.action,
      targetId: decision.targetId,
      text,
    });
    broadcast({
      type: "askjev.autopilot.log",
      line: exec?.detail || "executed",
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
  return undefined;
});
