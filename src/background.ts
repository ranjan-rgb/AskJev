import { DEFAULTS, type AskJevSettings } from "./defaults.js";
import { callJev } from "./jev.js";
import { decideNextStep, extractQuotedText } from "./autopilot-jev.js";
import {
  bridgeError,
  guardAct,
  type BridgeStatusSnapshot,
} from "./bridge.js";
import type { DomAction } from "./dom.js";

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

/** Last bridge status reported by the offscreen WebSocket host. */
let lastBridgeSnap: BridgeStatusSnapshot = {
  state: "disabled",
  detail: "bridge off",
  reconnectAttempt: 0,
};

function broadcast(msg: object): void {
  void chrome.runtime.sendMessage(msg).catch(() => undefined);
}

/** Thin facade: WS lives in offscreen; SW only forwards emit / reads cached status. */
const bridgeClient = {
  getSnapshot(): BridgeStatusSnapshot {
    return lastBridgeSnap;
  },
  emit(event: string, data?: unknown): void {
    void chrome.runtime
      .sendMessage({ type: "askjev.offscreen.emit", event, data })
      .catch(() => undefined);
  },
};

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
      const { apiKey, bridgeToken, ...rest } = s;
      sendResponse({
        ok: true,
        settings: {
          ...rest,
          hasKey: Boolean(apiKey && String(apiKey).trim()),
          hasBridgeToken: Boolean(bridgeToken && String(bridgeToken).trim()),
        },
      });
    });
    return true;
  }

  if (msg?.type === "askjev.bridge.status") {
    sendResponse({ ok: true, bridge: bridgeClient.getSnapshot() });
    return true;
  }

  if (msg?.type === "askjev.offscreen.status") {
    lastBridgeSnap = msg.bridge as BridgeStatusSnapshot;
    broadcast({ type: "askjev.bridge.status", bridge: lastBridgeSnap });
    sendResponse({ ok: true });
    return true;
  }

  if (msg?.type === "askjev.offscreen.rpc") {
    void (async () => {
      try {
        const result = await handleBridgeRpc(
          String(msg.method || ""),
          (msg.params || {}) as Record<string, unknown>,
        );
        sendResponse({ ok: true, result });
      } catch (e) {
        const err = e as Error & { code?: string };
        sendResponse({
          ok: false,
          error: {
            code: err.code || "internal",
            message: err.message || String(e),
          },
        });
      }
    })();
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

/** ---- Offscreen bridge host ---- */
const OFFSCREEN_URL = "offscreen.html";

async function hasOffscreenDocument(): Promise<boolean> {
  try {
    if (!chrome.runtime.getContexts) return false;
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
    });
    return contexts.length > 0;
  } catch {
    return false;
  }
}

async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreenDocument()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [chrome.offscreen.Reason.BLOBS],
    justification:
      "Keep the AskJev MCP agent-bridge WebSocket alive across service-worker idle so Claude/Cursor RPCs (list_tabs, status, act) do not disconnect mid-call.",
  });
}

async function closeOffscreen(): Promise<void> {
  try {
    if (await hasOffscreenDocument()) {
      await chrome.offscreen.closeDocument();
    }
  } catch {
    /* ignore */
  }
  lastBridgeSnap = {
    state: "disabled",
    detail: "bridge off",
    reconnectAttempt: 0,
  };
}

async function syncBridge(): Promise<void> {
  const settings = await getSettings();
  if (!settings.bridgeEnabled || !settings.bridgeToken) {
    await closeOffscreen();
    broadcast({ type: "askjev.bridge.status", bridge: lastBridgeSnap });
    return;
  }
  await ensureOffscreen();
  try {
    await chrome.runtime.sendMessage({ type: "askjev.offscreen.sync" });
  } catch {
    /* offscreen may still be booting — alarm will retry */
  }
}

/** ---- Autopilot ---- */
let autopilotRunning = false;
let lastAutopilotStatus = "idle";

async function getActiveTabId(): Promise<number | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id;
}

function setAutopilotStatus(status: string): void {
  lastAutopilotStatus = status;
  broadcast({ type: "askjev.autopilot.status", status });
  bridgeClient.emit("autopilot_status", { status });
}

async function runAutopilot(goal: string, typeText?: string): Promise<void> {
  const settings = await getSettings();
  if (!settings.apiKey?.trim()) {
    setAutopilotStatus("missing TypeSafe API key — open Options");
    return;
  }
  autopilotRunning = true;
  setAutopilotStatus("running");
  const maxSteps = 20;
  const pinnedTabId = await getActiveTabId();
  if (pinnedTabId == null) {
    setAutopilotStatus("no active tab — click the page tab, then Run");
    autopilotRunning = false;
    return;
  }
  for (let step = 1; step <= maxSteps && autopilotRunning; step++) {
    const tabId = pinnedTabId;
    broadcast({
      type: "askjev.autopilot.log",
      line: `step ${step}: snapshot`,
    });
    bridgeClient.emit("autopilot_log", { line: `step ${step}: snapshot` });
    let snap: { ok?: boolean; error?: string; state?: string; elements?: unknown } | undefined;
    try {
      snap = await chrome.tabs.sendMessage(tabId, {
        type: "askjev.dom.snapshot",
        goal,
      });
    } catch (e) {
      const line = `snapshot failed: ${(e as Error).message || "no content script — refresh the page"}`;
      broadcast({ type: "askjev.autopilot.log", line });
      bridgeClient.emit("autopilot_log", { line });
      setAutopilotStatus("refresh the page, then Run again");
      break;
    }
    if (!snap?.ok) {
      const line = `snapshot failed: ${snap?.error || "unknown"}`;
      broadcast({ type: "askjev.autopilot.log", line });
      bridgeClient.emit("autopilot_log", { line });
      setAutopilotStatus("snapshot failed");
      break;
    }

    broadcast({
      type: "askjev.autopilot.log",
      line: `step ${step}: asking jev…`,
    });
    let decision;
    try {
      decision = await Promise.race([
        decideNextStep({
          apiKey: settings.apiKey,
          state: snap.state as string,
          elements: snap.elements as import("./dom.js").DomElement[],
          model: settings.model,
          step,
        }),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error("jev_timeout_15s")), 15000),
        ),
      ]);
    } catch (e) {
      await bumpStat("errors");
      const line = `jev error: ${(e as Error).message}`;
      broadcast({ type: "askjev.autopilot.log", line });
      bridgeClient.emit("autopilot_log", { line });
      setAutopilotStatus("jev error — check API key / network");
      break;
    }

    const line = `jev → ${decision.action} target=${decision.targetId ?? "none"} irr=${decision.irreversible.toFixed(2)}`;
    broadcast({ type: "askjev.autopilot.log", line });
    bridgeClient.emit("autopilot_log", { line });

    if (decision.done || decision.action === "DONE") {
      setAutopilotStatus("done");
      await bumpStat("proceeded");
      break;
    }
    if (decision.action === "BLOCKED") {
      setAutopilotStatus("blocked by jev");
      await bumpStat("blocked");
      break;
    }

    // Guard: irreversible actions need explicit confirm via sidepanel status
    if (decision.irreversible >= 0.65) {
      setAutopilotStatus(
        `guard: irreversible (${decision.irreversible.toFixed(2)}) — stopped. Use Guard overlay or lower risk goal.`,
      );
      await bumpStat("blocked");
      break;
    }

    const text = typeText || extractQuotedText(goal) || undefined;
    const exec = await chrome.tabs.sendMessage(tabId, {
      type: "askjev.dom.execute",
      action: decision.action,
      targetId: decision.targetId,
      text,
    });
    const execLine = exec?.detail || "executed";
    broadcast({ type: "askjev.autopilot.log", line: execLine });
    bridgeClient.emit("autopilot_log", { line: execLine });
    await new Promise((r) => setTimeout(r, 700));
  }
  autopilotRunning = false;
  if (lastAutopilotStatus === "running") setAutopilotStatus("idle");
  else broadcast({ type: "askjev.autopilot.status", status: lastAutopilotStatus });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "askjev.autopilot.start") {
    void runAutopilot(String(msg.goal || ""), msg.typeText);
    sendResponse({ ok: true });
    return true;
  }
  if (msg?.type === "askjev.autopilot.stop") {
    autopilotRunning = false;
    setAutopilotStatus("stopped");
    sendResponse({ ok: true });
    return true;
  }
  return undefined;
});

/** ---- Agent bridge RPC handlers (run in SW — chrome.tabs / storage) ---- */
async function handleBridgeRpc(
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const settings = await getSettings();

  if (method === "start_goal") {
    if (!settings.apiKey?.trim()) {
      throw bridgeError("missing_api_key", "TypeSafe API key required in Options");
    }
    const goal = String(params.goal || "").trim();
    if (!goal) throw bridgeError("invalid_params", "goal is required");
    if (autopilotRunning) {
      autopilotRunning = false;
      await new Promise((r) => setTimeout(r, 100));
    }
    void runAutopilot(goal, params.typeText ? String(params.typeText) : undefined);
    return { started: true, goal };
  }

  if (method === "stop") {
    autopilotRunning = false;
    setAutopilotStatus("stopped");
    return { stopped: true };
  }

  if (method === "status") {
    return {
      autopilotRunning,
      lastAutopilotStatus,
      bridge: bridgeClient.getSnapshot(),
      hasApiKey: Boolean(settings.apiKey?.trim()),
    };
  }

  if (method === "list_tabs") {
    const tabs = await chrome.tabs.query({});
    return {
      tabs: tabs.map((t) => ({
        id: t.id,
        title: t.title || "",
        url: t.url || "",
        active: Boolean(t.active),
        windowId: t.windowId,
      })),
    };
  }

  if (method === "snapshot") {
    const tabId = await getActiveTabId();
    if (tabId == null) throw bridgeError("internal", "no active tab");
    const goal = String(params.goal || "");
    const snap = await chrome.tabs.sendMessage(tabId, {
      type: "askjev.dom.snapshot",
      goal,
    });
    if (!snap?.ok) {
      throw bridgeError("internal", snap?.error || "snapshot failed");
    }
    return { elements: snap.elements, state: snap.state };
  }

  if (method === "act") {
    if (!settings.apiKey?.trim()) {
      throw bridgeError("missing_api_key", "TypeSafe API key required for guarded acts");
    }
    const action = String(params.action || "") as DomAction;
    const targetId =
      params.targetId != null ? Number(params.targetId) : undefined;
    const text = params.text != null ? String(params.text) : undefined;
    const tabId = await getActiveTabId();
    if (tabId == null) throw bridgeError("internal", "no active tab");

    const snap = await chrome.tabs.sendMessage(tabId, {
      type: "askjev.dom.snapshot",
      goal: `agent act ${action}`,
    });
    if (!snap?.ok) {
      throw bridgeError("internal", snap?.error || "snapshot failed");
    }

    const guard = await guardAct({
      apiKey: settings.apiKey,
      model: settings.model,
      sensitivity: settings.sensitivity,
      action,
      targetId,
      text,
      pageState: snap.state,
    });
    if (guard.blocked) {
      await bumpStat("blocked");
      throw bridgeError(
        "guard_blocked",
        `irreversible=${guard.irreversible.toFixed(2)} ≥ 0.65 — act blocked`,
      );
    }

    const exec = await chrome.tabs.sendMessage(tabId, {
      type: "askjev.dom.execute",
      action,
      targetId,
      text,
    });
    return {
      ...exec,
      irreversible: guard.irreversible,
    };
  }

  throw bridgeError("invalid_params", `unknown method ${method}`);
}

void syncBridge();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  if (
    changes.bridgeEnabled ||
    changes.bridgeToken ||
    changes.bridgePort
  ) {
    void syncBridge();
  }
});

/** Keep offscreen + bridge armed while enabled (alarms wake the SW). */
chrome.alarms.create("askjev.bridge.keepalive", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "askjev.bridge.keepalive") {
    void syncBridge();
  }
});
