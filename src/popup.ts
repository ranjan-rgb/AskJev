/** Layout classes the state dot keeps across every state change. */
const DOT_BASE = "dot mt-[5px] shrink-0";

/** One readiness sentence + the dot that colours it. */
function setState(kind: "ok" | "warn" | "off", message: string): void {
  const dot = document.getElementById("stateDot");
  if (dot) dot.className = DOT_BASE + (kind === "off" ? "" : ` ${kind}`);
  const text = document.getElementById("stateText");
  if (text) text.textContent = message;
}

/** Exactly one button is highlighted — the next click the user should make. */
function setPrimary(id: "auto" | "opts" | null): void {
  for (const btn of ["auto", "opts"] as const) {
    document.getElementById(btn)?.classList.toggle("aj-btn-primary", btn === id);
  }
}

async function loadPopup(): Promise<void> {
  const s = await chrome.storage.sync.get(null);
  const armed = s.enabled !== false;
  const en = document.getElementById("en") as HTMLButtonElement;
  en.classList.toggle("on", armed);
  en.setAttribute("aria-pressed", armed ? "true" : "false");

  const hasKey = Boolean(s.apiKey && String(s.apiKey).trim());
  const bridgeOn = Boolean(s.bridgeEnabled);
  const token = Boolean(s.bridgeToken && String(s.bridgeToken).trim());
  let paired = false;
  try {
    const resp = await chrome.runtime.sendMessage({ type: "askjev.bridge.status" });
    if (resp?.ok && resp.bridge?.state === "paired") paired = true;
  } catch {
    /* ignore */
  }

  // Worst blocker first: the sentence always names the single thing standing in the way.
  if (!armed) {
    setState("off", "AskJev is off. Flip the switch above to let Claude drive this browser.");
    setPrimary(null);
  } else if (!hasKey) {
    setState("warn", "No TypeSafe API key yet. Add it in Settings to arm Autopilot and Guard.");
    setPrimary("opts");
  } else if (!bridgeOn || !token) {
    setState("warn", "Claude is not connected. Run Auto-connect in Settings, then restart Claude.");
    setPrimary("opts");
  } else if (!paired) {
    setState("warn", "Waiting for Claude. Restart Claude, then ask it to use this browser.");
    setPrimary("opts");
  } else {
    setState("ok", "Ready. Claude can drive this browser — Guard holds irreversible clicks.");
    setPrimary("auto");
  }
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
