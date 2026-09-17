// src/sidepanel.ts
var goalEl = document.getElementById("goal");
var typeEl = document.getElementById("typeText");
var logEl = document.getElementById("log");
var statusEl = document.getElementById("status");
var runBtn = document.getElementById("run");
var stopBtn = document.getElementById("stop");
function log(line) {
  const t = (/* @__PURE__ */ new Date()).toLocaleTimeString();
  logEl.textContent = `[${t}] ${line}
` + logEl.textContent;
}
runBtn.addEventListener("click", () => {
  const goal = goalEl.value.trim();
  if (!goal) {
    statusEl.textContent = "enter a goal";
    return;
  }
  statusEl.textContent = "running\u2026";
  chrome.runtime.sendMessage(
    {
      type: "askjev.autopilot.start",
      goal,
      typeText: typeEl.value.trim() || void 0
    },
    (resp) => {
      if (chrome.runtime.lastError) {
        statusEl.textContent = chrome.runtime.lastError.message || "error";
        return;
      }
      if (!resp?.ok) statusEl.textContent = resp?.error || "failed";
      else statusEl.textContent = "autopilot started";
    }
  );
});
stopBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "askjev.autopilot.stop" }, () => {
    statusEl.textContent = "stopped";
  });
});
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "askjev.autopilot.log") {
    log(String(msg.line || ""));
  }
  if (msg?.type === "askjev.autopilot.status") {
    statusEl.textContent = String(msg.status || "");
  }
});
//# sourceMappingURL=sidepanel.js.map
