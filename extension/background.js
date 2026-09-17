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
  stats: { blocked: 0, asked: 0, proceeded: 0, errors: 0 },
  bridgeEnabled: false,
  bridgeToken: "",
  bridgePort: 17373
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

// src/bridge.ts
var BRIDGE_PROTOCOL_VERSION = "1.0";
function tokensEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
var AgentBridgeClient = class {
  ws = null;
  settings = null;
  handleRpc;
  state = "disabled";
  detail = "bridge off";
  lastError;
  reconnectAttempt = 0;
  reconnectTimer = null;
  pingTimer = null;
  stopped = true;
  onStatus;
  constructor(handleRpc, onStatus) {
    this.handleRpc = handleRpc;
    this.onStatus = onStatus;
  }
  getSnapshot() {
    return {
      state: this.state,
      detail: this.detail,
      lastError: this.lastError,
      reconnectAttempt: this.reconnectAttempt
    };
  }
  /** Apply latest settings; start/stop/reconnect as needed. */
  sync(settings) {
    const prev = this.settings;
    this.settings = settings;
    if (!settings.bridgeEnabled || !settings.bridgeToken) {
      this.stop();
      this.setState("disabled", settings.bridgeEnabled ? "generate a pairing token" : "bridge off");
      return;
    }
    const portChanged = prev && (prev.bridgePort !== settings.bridgePort || prev.bridgeToken !== settings.bridgeToken);
    if (this.stopped || portChanged || this.state === "disabled" || this.state === "error") {
      this.start();
    }
  }
  start() {
    this.stopped = false;
    this.clearReconnect();
    this.connect();
  }
  stop() {
    this.stopped = true;
    this.clearReconnect();
    this.clearPing();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
      }
      this.ws = null;
    }
  }
  connect() {
    if (this.stopped || !this.settings?.bridgeEnabled || !this.settings.bridgeToken) {
      return;
    }
    const port = this.settings.bridgePort || 17373;
    const url = `ws://127.0.0.1:${port}`;
    this.setState("connecting", `dialing ${url}`);
    try {
      if (this.ws) {
        try {
          this.ws.close();
        } catch {
        }
      }
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.addEventListener("open", () => {
        this.reconnectAttempt = 0;
        this.setState("connected", "sending hello");
        ws.send(
          JSON.stringify({
            type: "hello",
            token: this.settings.bridgeToken,
            role: "extension",
            version: BRIDGE_PROTOCOL_VERSION
          })
        );
        this.startPing();
      });
      ws.addEventListener("message", (ev) => {
        void this.onMessage(String(ev.data || ""));
      });
      ws.addEventListener("close", () => {
        this.clearPing();
        this.ws = null;
        if (!this.stopped) this.scheduleReconnect();
      });
      ws.addEventListener("error", () => {
        this.lastError = "websocket error";
      });
    } catch (e) {
      this.lastError = String(e.message || e);
      this.scheduleReconnect();
    }
  }
  async onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const type = msg.type;
    if (type === "hello") {
      this.setState("paired", "paired with askjev-mcp");
      return;
    }
    if (type === "pong") return;
    if (type === "error") {
      this.lastError = String(msg.message || msg.code || "error");
      if (msg.code === "unauthorized") {
        this.setState("error", "unauthorized \u2014 check pairing token");
        this.stop();
        this.stopped = false;
      }
      return;
    }
    if (type === "rpc") {
      await this.onRpc(msg);
    }
  }
  async onRpc(msg) {
    const id = String(msg.id || "");
    const token = String(msg.token || "");
    const method = String(msg.method || "");
    const params = msg.params || {};
    const reply = (payload) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(
          JSON.stringify({
            type: "rpc_result",
            id,
            ok: payload.ok,
            result: payload.result,
            error: payload.error
          })
        );
      }
    };
    if (!this.settings || !tokensEqual(token, this.settings.bridgeToken)) {
      reply({
        ok: false,
        error: { code: "unauthorized", message: "invalid pairing token" }
      });
      return;
    }
    try {
      const result = await this.handleRpc(method, params);
      reply({ ok: true, result });
    } catch (e) {
      const err = e;
      reply({
        ok: false,
        error: {
          code: err.code || "internal",
          message: err.message || String(e)
        }
      });
    }
  }
  /** Emit a fire-and-forget event to the MCP bridge (logs / status). */
  emit(event, data) {
    if (this.ws?.readyState === WebSocket.OPEN && this.settings?.bridgeToken) {
      this.ws.send(
        JSON.stringify({
          type: "event",
          event,
          data,
          token: this.settings.bridgeToken
        })
      );
    }
  }
  scheduleReconnect() {
    if (this.stopped) return;
    this.reconnectAttempt += 1;
    const delay = Math.min(3e4, 500 * 2 ** Math.min(this.reconnectAttempt, 6));
    this.setState("backoff", `reconnect in ${Math.round(delay / 1e3)}s`);
    this.clearReconnect();
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
  clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
  startPing() {
    this.clearPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN && this.settings?.bridgeToken) {
        this.ws.send(
          JSON.stringify({ type: "ping", token: this.settings.bridgeToken })
        );
      }
    }, 2e4);
  }
  clearPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
  setState(state, detail) {
    this.state = state;
    this.detail = detail;
    this.onStatus?.(this.getSnapshot());
  }
};
async function guardAct(input) {
  const skip = input.action === "SCROLL_DOWN" || input.action === "SCROLL_UP" || input.action === "WAIT" || input.action === "DONE";
  if (skip) return { blocked: false, irreversible: 0 };
  const state = [
    input.pageState,
    `proposed_action: ${input.action} targetId=${input.targetId ?? "none"} text=${(input.text || "").slice(0, 80)}`
  ].join("\n");
  const result = await callJev({
    state,
    apiKey: input.apiKey,
    model: input.model,
    sensitivity: input.sensitivity
  });
  const irreversible = Number(result.answers?.irreversible?.noul ?? 0);
  return { blocked: irreversible >= 0.65, irreversible };
}
function bridgeError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
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
      const { apiKey, bridgeToken, ...rest } = s;
      sendResponse({
        ok: true,
        settings: {
          ...rest,
          hasKey: Boolean(apiKey && String(apiKey).trim()),
          hasBridgeToken: Boolean(bridgeToken && String(bridgeToken).trim())
        }
      });
    });
    return true;
  }
  if (msg?.type === "askjev.bridge.status") {
    sendResponse({ ok: true, bridge: bridgeClient.getSnapshot() });
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
var lastAutopilotStatus = "idle";
async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id;
}
function broadcast(msg) {
  void chrome.runtime.sendMessage(msg).catch(() => void 0);
}
function setAutopilotStatus(status) {
  lastAutopilotStatus = status;
  broadcast({ type: "askjev.autopilot.status", status });
  bridgeClient.emit("autopilot_status", { status });
}
async function runAutopilot(goal, typeText) {
  const settings = await getSettings();
  if (!settings.apiKey?.trim()) {
    setAutopilotStatus("missing TypeSafe API key \u2014 open Options");
    return;
  }
  autopilotRunning = true;
  setAutopilotStatus("running");
  const maxSteps = 20;
  for (let step = 1; step <= maxSteps && autopilotRunning; step++) {
    const tabId = await getActiveTabId();
    if (tabId == null) {
      setAutopilotStatus("no active tab");
      break;
    }
    broadcast({
      type: "askjev.autopilot.log",
      line: `step ${step}: snapshot`
    });
    bridgeClient.emit("autopilot_log", { line: `step ${step}: snapshot` });
    const snap = await chrome.tabs.sendMessage(tabId, {
      type: "askjev.dom.snapshot",
      goal
    });
    if (!snap?.ok) {
      const line2 = `snapshot failed: ${snap?.error || "unknown"}`;
      broadcast({ type: "askjev.autopilot.log", line: line2 });
      bridgeClient.emit("autopilot_log", { line: line2 });
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
      const line2 = `jev error: ${e.message}`;
      broadcast({ type: "askjev.autopilot.log", line: line2 });
      bridgeClient.emit("autopilot_log", { line: line2 });
      break;
    }
    const line = `jev \u2192 ${decision.action} target=${decision.targetId ?? "none"} irr=${decision.irreversible.toFixed(2)}`;
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
    if (decision.irreversible >= 0.65) {
      setAutopilotStatus(
        `guard: irreversible (${decision.irreversible.toFixed(2)}) \u2014 stopped. Use Guard overlay or lower risk goal.`
      );
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
  return void 0;
});
async function handleBridgeRpc(method, params) {
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
    void runAutopilot(goal, params.typeText ? String(params.typeText) : void 0);
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
      hasApiKey: Boolean(settings.apiKey?.trim())
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
        windowId: t.windowId
      }))
    };
  }
  if (method === "snapshot") {
    const tabId = await getActiveTabId();
    if (tabId == null) throw bridgeError("internal", "no active tab");
    const goal = String(params.goal || "");
    const snap = await chrome.tabs.sendMessage(tabId, {
      type: "askjev.dom.snapshot",
      goal
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
    const action = String(params.action || "");
    const targetId = params.targetId != null ? Number(params.targetId) : void 0;
    const text = params.text != null ? String(params.text) : void 0;
    const tabId = await getActiveTabId();
    if (tabId == null) throw bridgeError("internal", "no active tab");
    const snap = await chrome.tabs.sendMessage(tabId, {
      type: "askjev.dom.snapshot",
      goal: `agent act ${action}`
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
      pageState: snap.state
    });
    if (guard.blocked) {
      await bumpStat("blocked");
      throw bridgeError(
        "guard_blocked",
        `irreversible=${guard.irreversible.toFixed(2)} \u2265 0.65 \u2014 act blocked`
      );
    }
    const exec = await chrome.tabs.sendMessage(tabId, {
      type: "askjev.dom.execute",
      action,
      targetId,
      text
    });
    return {
      ...exec,
      irreversible: guard.irreversible
    };
  }
  throw bridgeError("invalid_params", `unknown method ${method}`);
}
function onBridgeStatus(snap) {
  broadcast({ type: "askjev.bridge.status", bridge: snap });
}
var bridgeClient = new AgentBridgeClient(handleBridgeRpc, onBridgeStatus);
async function syncBridge() {
  const settings = await getSettings();
  bridgeClient.sync(settings);
}
void syncBridge();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  if (changes.bridgeEnabled || changes.bridgeToken || changes.bridgePort) {
    void syncBridge();
  }
});
chrome.alarms.create("askjev.bridge.keepalive", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "askjev.bridge.keepalive") {
    void syncBridge();
  }
});
//# sourceMappingURL=background.js.map
