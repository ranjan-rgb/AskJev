const goalEl = document.getElementById("goal") as HTMLTextAreaElement;
const typeEl = document.getElementById("typeText") as HTMLInputElement;
const logEl = document.getElementById("log") as HTMLElement;
const statusEl = document.getElementById("status") as HTMLElement;
const runBtn = document.getElementById("run") as HTMLButtonElement;
const stopBtn = document.getElementById("stop") as HTMLButtonElement;

function log(line: string): void {
  const t = new Date().toLocaleTimeString();
  logEl.textContent = `[${t}] ${line}\n` + logEl.textContent;
}

runBtn.addEventListener("click", () => {
  const goal = goalEl.value.trim();
  if (!goal) {
    statusEl.textContent = "enter a goal";
    return;
  }
  statusEl.textContent = "running…";
  chrome.runtime.sendMessage(
    {
      type: "askjev.autopilot.start",
      goal,
      typeText: typeEl.value.trim() || undefined,
    },
    (resp) => {
      if (chrome.runtime.lastError) {
        statusEl.textContent = chrome.runtime.lastError.message || "error";
        return;
      }
      if (!resp?.ok) statusEl.textContent = resp?.error || "failed";
      else statusEl.textContent = "autopilot started";
    },
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
