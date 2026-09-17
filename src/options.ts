import { generateBridgeToken } from "./defaults.js";

function setBridgeTokenDisplay(token: string): void {
  const el = document.getElementById("bridgeTokenDisplay") as HTMLElement;
  el.textContent = token || "(none — generate one)";
}

async function refreshBridgeStatus(): Promise<void> {
  const el = document.getElementById("bridgeStatus") as HTMLElement;
  try {
    const resp = await chrome.runtime.sendMessage({ type: "askjev.bridge.status" });
    if (resp?.ok && resp.bridge) {
      const b = resp.bridge as { state: string; detail: string };
      el.textContent = `${b.state}: ${b.detail}`;
      return;
    }
  } catch {
    /* ignore */
  }
  el.textContent = "status unavailable";
}

async function loadOptions(): Promise<void> {
  const s = await chrome.storage.sync.get(null);
  (document.getElementById("apiKey") as HTMLInputElement).value = s.apiKey || "";
  (document.getElementById("sensitivity") as HTMLSelectElement).value =
    s.sensitivity || "balanced";
  (document.getElementById("keywords") as HTMLInputElement).value = (
    s.customKeywords || []
  ).join(", ");
  (document.getElementById("allowlist") as HTMLTextAreaElement).value = (
    s.allowlist || []
  ).join("\n");
  (document.getElementById("enabled") as HTMLInputElement).checked =
    s.enabled !== false;
  (document.getElementById("confirmAsk") as HTMLInputElement).checked =
    s.requireConfirmOnAsk !== false;
  (document.getElementById("gateForms") as HTMLInputElement).checked =
    s.gateFormSubmits === true;
  (document.getElementById("bridgeEnabled") as HTMLInputElement).checked =
    s.bridgeEnabled === true;
  (document.getElementById("bridgePort") as HTMLInputElement).value = String(
    s.bridgePort || 17373,
  );
  setBridgeTokenDisplay(s.bridgeToken || "");
  await refreshBridgeStatus();
}

document.getElementById("save")!.addEventListener("click", () => {
  void (async () => {
    const apiKey = (
      document.getElementById("apiKey") as HTMLInputElement
    ).value.trim();
    const sensitivity = (
      document.getElementById("sensitivity") as HTMLSelectElement
    ).value;
    const customKeywords = (
      document.getElementById("keywords") as HTMLInputElement
    ).value
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    const allowlist = (
      document.getElementById("allowlist") as HTMLTextAreaElement
    ).value
      .split(/\n+/)
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
    const bridgePort = Number(
      (document.getElementById("bridgePort") as HTMLInputElement).value,
    ) || 17373;
    const cur = await chrome.storage.sync.get(["bridgeToken"]);
    await chrome.storage.sync.set({
      apiKey,
      sensitivity,
      customKeywords,
      allowlist,
      enabled: (document.getElementById("enabled") as HTMLInputElement).checked,
      requireConfirmOnAsk: (
        document.getElementById("confirmAsk") as HTMLInputElement
      ).checked,
      gateFormSubmits: (
        document.getElementById("gateForms") as HTMLInputElement
      ).checked,
      model: "jev-latest",
      bridgeEnabled: (
        document.getElementById("bridgeEnabled") as HTMLInputElement
      ).checked,
      bridgePort,
      bridgeToken: cur.bridgeToken || "",
    });
    (document.getElementById("status") as HTMLElement).textContent = "saved";
    await refreshBridgeStatus();
  })();
});

document.getElementById("genToken")!.addEventListener("click", () => {
  void (async () => {
    const token = generateBridgeToken();
    await chrome.storage.sync.set({ bridgeToken: token });
    setBridgeTokenDisplay(token);
    (document.getElementById("status") as HTMLElement).textContent =
      "token generated — copy into ASKJEV_TOKEN";
    await refreshBridgeStatus();
  })();
});

document.getElementById("copyToken")!.addEventListener("click", () => {
  void (async () => {
    const s = await chrome.storage.sync.get(["bridgeToken"]);
    const token = String(s.bridgeToken || "");
    if (!token) {
      (document.getElementById("status") as HTMLElement).textContent =
        "no token to copy";
      return;
    }
    try {
      await navigator.clipboard.writeText(token);
      (document.getElementById("status") as HTMLElement).textContent = "copied";
    } catch {
      (document.getElementById("status") as HTMLElement).textContent =
        "copy failed — select token manually";
    }
  })();
});

document.getElementById("revokeToken")!.addEventListener("click", () => {
  void (async () => {
    await chrome.storage.sync.set({
      bridgeToken: "",
      bridgeEnabled: false,
    });
    (document.getElementById("bridgeEnabled") as HTMLInputElement).checked =
      false;
    setBridgeTokenDisplay("");
    (document.getElementById("status") as HTMLElement).textContent =
      "token revoked";
    await refreshBridgeStatus();
  })();
});

setInterval(() => {
  void refreshBridgeStatus();
}, 3000);

void loadOptions();
