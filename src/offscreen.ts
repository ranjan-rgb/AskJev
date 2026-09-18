/**
 * Offscreen document: owns the AgentBridgeClient WebSocket.
 * MV3 service workers suspend and kill in-SW sockets mid-RPC; this page stays alive.
 * RPCs are forwarded to the service worker (chrome.tabs / storage live there).
 */
import {
  AgentBridgeClient,
  bridgeError,
  type BridgeStatusSnapshot,
} from "./bridge.js";
import { DEFAULTS, type AskJevSettings } from "./defaults.js";

async function getSettings(): Promise<AskJevSettings> {
  const stored = (await chrome.storage.sync.get(null)) as Partial<AskJevSettings>;
  return {
    ...DEFAULTS,
    ...stored,
    stats: { ...DEFAULTS.stats, ...(stored.stats || {}) },
  };
}

function reportStatus(snap: BridgeStatusSnapshot): void {
  void chrome.runtime
    .sendMessage({ type: "askjev.offscreen.status", bridge: snap })
    .catch(() => undefined);
}

const bridgeClient = new AgentBridgeClient(async (method, params) => {
  const resp = (await chrome.runtime.sendMessage({
    type: "askjev.offscreen.rpc",
    method,
    params,
  })) as
    | { ok: true; result: unknown }
    | { ok: false; error?: { code?: string; message?: string } }
    | undefined;

  if (chrome.runtime.lastError) {
    throw bridgeError(
      "internal",
      chrome.runtime.lastError.message || "service worker unreachable",
    );
  }
  if (!resp?.ok) {
    throw bridgeError(
      resp?.error?.code || "internal",
      resp?.error?.message || "rpc failed in service worker",
    );
  }
  return resp.result;
}, reportStatus);

async function syncBridge(): Promise<void> {
  const settings = await getSettings();
  bridgeClient.sync(settings);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "askjev.offscreen.sync") {
    void syncBridge().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === "askjev.offscreen.emit") {
    bridgeClient.emit(String(msg.event || ""), msg.data);
    sendResponse({ ok: true });
    return true;
  }
  if (msg?.type === "askjev.offscreen.getStatus") {
    sendResponse({ ok: true, bridge: bridgeClient.getSnapshot() });
    return true;
  }
  if (msg?.type === "askjev.offscreen.stop") {
    bridgeClient.stop();
    sendResponse({ ok: true });
    return true;
  }
  return undefined;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  if (changes.bridgeEnabled || changes.bridgeToken || changes.bridgePort) {
    void syncBridge();
  }
});

void syncBridge();
