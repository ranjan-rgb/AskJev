function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setDot(id: string, kind: "ok" | "warn" | "off"): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = "dot" + (kind === "off" ? "" : ` ${kind}`);
}

async function loadPopup(): Promise<void> {
  const s = await chrome.storage.sync.get(null);
  const armed = s.enabled !== false;
  const en = document.getElementById("en") as HTMLButtonElement;
  en.classList.toggle("on", armed);
  en.setAttribute("aria-pressed", armed ? "true" : "false");
  setText("armLabel", armed ? "Protection on" : "Protection off");

  setText("b", String(s.stats?.blocked || 0));
  setText("a", String(s.stats?.asked || 0));
  setText("p", String(s.stats?.proceeded || 0));

  const hasKey = Boolean(s.apiKey && String(s.apiKey).trim());
  setText("key", hasKey ? "Ready" : "Add in Settings");
  setDot("keyDot", hasKey ? "ok" : "warn");

  const bridgeOn = Boolean(s.bridgeEnabled);
  const token = Boolean(s.bridgeToken && String(s.bridgeToken).trim());
  let paired = false;
  try {
    const resp = await chrome.runtime.sendMessage({ type: "askjev.bridge.status" });
    if (resp?.ok && resp.bridge?.state === "paired") paired = true;
  } catch {
    /* ignore */
  }

  if (paired) {
    setText("bridge", "Connected");
    setDot("bridgeDot", "ok");
  } else if (bridgeOn && token) {
    setText("bridge", "Waiting for Claude");
    setDot("bridgeDot", "warn");
  } else if (bridgeOn) {
    setText("bridge", "Needs token");
    setDot("bridgeDot", "warn");
  } else {
    setText("bridge", "Off");
    setDot("bridgeDot", "off");
  }

  setText("mode", bridgeOn ? "Agent + Guard" : "Guard");
  setDot("modeDot", "ok");
}

document.getElementById("en")!.addEventListener("click", () => {
  void (async () => {
    const s = await chrome.storage.sync.get(["enabled"]);
    await chrome.storage.sync.set({ enabled: !(s.enabled !== false) });
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
