function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setClass(id: string, className: string): void {
  const el = document.getElementById(id);
  if (el) el.className = className;
}

async function loadPopup(): Promise<void> {
  const s = await chrome.storage.sync.get(null);
  const armed = s.enabled !== false;
  const en = document.getElementById("en") as HTMLButtonElement;
  en.classList.toggle("on", armed);
  en.setAttribute("aria-pressed", armed ? "true" : "false");
  en.textContent = armed ? "Armed" : "Disarmed";

  setText("b", String(s.stats?.blocked || 0));
  setText("a", String(s.stats?.asked || 0));
  setText("p", String(s.stats?.proceeded || 0));

  const hasKey = Boolean(s.apiKey && String(s.apiKey).trim());
  setText("key", hasKey ? "Set" : "Missing");
  setClass("key", hasKey ? "v ok" : "v warn");

  const bridgeOn = Boolean(s.bridgeEnabled);
  const token = Boolean(s.bridgeToken && String(s.bridgeToken).trim());
  let bridgeLabel = "Off";
  let bridgeClass = "v bad";
  if (bridgeOn && token) {
    bridgeLabel = "Armed";
    bridgeClass = "v ok";
  } else if (bridgeOn && !token) {
    bridgeLabel = "No token";
    bridgeClass = "v warn";
  }
  setText("bridge", bridgeLabel);
  setClass("bridge", bridgeClass);

  setText("mode", bridgeOn ? "Agent" : "Guard");
  setClass("mode", "v ok");
}

document.getElementById("en")!.addEventListener("click", () => {
  void (async () => {
    const s = await chrome.storage.sync.get(["enabled"]);
    const next = !(s.enabled !== false);
    await chrome.storage.sync.set({ enabled: next });
    await loadPopup();
  })();
});

document.getElementById("opts")!.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById("auto")?.addEventListener("click", () => {
  void (async () => {
    const win = await chrome.windows.getCurrent();
    if (win.id != null) await chrome.sidePanel.open({ windowId: win.id });
  })();
});

document.getElementById("docs")?.addEventListener("click", () => {
  void chrome.tabs.create({
    url: "https://github.com/ranjan2829/AskJev/blob/main/docs/AGENT-BRIDGE.md",
  });
});

void loadPopup();
