// src/defaults.ts
function generateBridgeToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// src/options.ts
function setBridgeTokenDisplay(token) {
  const el = document.getElementById("bridgeTokenDisplay");
  el.textContent = token || "(none \u2014 generate one)";
}
async function refreshBridgeStatus() {
  const el = document.getElementById("bridgeStatus");
  try {
    const resp = await chrome.runtime.sendMessage({ type: "askjev.bridge.status" });
    if (resp?.ok && resp.bridge) {
      const b = resp.bridge;
      el.textContent = `${b.state}: ${b.detail}`;
      return;
    }
  } catch {
  }
  el.textContent = "status unavailable";
}
async function loadOptions() {
  const s = await chrome.storage.sync.get(null);
  document.getElementById("apiKey").value = s.apiKey || "";
  document.getElementById("sensitivity").value = s.sensitivity || "balanced";
  document.getElementById("keywords").value = (s.customKeywords || []).join(", ");
  document.getElementById("allowlist").value = (s.allowlist || []).join("\n");
  document.getElementById("enabled").checked = s.enabled !== false;
  document.getElementById("confirmAsk").checked = s.requireConfirmOnAsk !== false;
  document.getElementById("gateForms").checked = s.gateFormSubmits === true;
  document.getElementById("bridgeEnabled").checked = s.bridgeEnabled === true;
  document.getElementById("bridgePort").value = String(
    s.bridgePort || 17373
  );
  setBridgeTokenDisplay(s.bridgeToken || "");
  await refreshBridgeStatus();
}
document.getElementById("save").addEventListener("click", () => {
  void (async () => {
    const apiKey = document.getElementById("apiKey").value.trim();
    const sensitivity = document.getElementById("sensitivity").value;
    const customKeywords = document.getElementById("keywords").value.split(",").map((x) => x.trim()).filter(Boolean);
    const allowlist = document.getElementById("allowlist").value.split(/\n+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    const bridgePort = Number(
      document.getElementById("bridgePort").value
    ) || 17373;
    const cur = await chrome.storage.sync.get(["bridgeToken"]);
    await chrome.storage.sync.set({
      apiKey,
      sensitivity,
      customKeywords,
      allowlist,
      enabled: document.getElementById("enabled").checked,
      requireConfirmOnAsk: document.getElementById("confirmAsk").checked,
      gateFormSubmits: document.getElementById("gateForms").checked,
      model: "jev-latest",
      bridgeEnabled: document.getElementById("bridgeEnabled").checked,
      bridgePort,
      bridgeToken: cur.bridgeToken || ""
    });
    document.getElementById("status").textContent = "saved";
    await refreshBridgeStatus();
  })();
});
document.getElementById("genToken").addEventListener("click", () => {
  void (async () => {
    const token = generateBridgeToken();
    await chrome.storage.sync.set({ bridgeToken: token });
    setBridgeTokenDisplay(token);
    document.getElementById("status").textContent = "token generated \u2014 copy into ASKJEV_TOKEN";
    await refreshBridgeStatus();
  })();
});
document.getElementById("copyToken").addEventListener("click", () => {
  void (async () => {
    const s = await chrome.storage.sync.get(["bridgeToken"]);
    const token = String(s.bridgeToken || "");
    if (!token) {
      document.getElementById("status").textContent = "no token to copy";
      return;
    }
    try {
      await navigator.clipboard.writeText(token);
      document.getElementById("status").textContent = "copied";
    } catch {
      document.getElementById("status").textContent = "copy failed \u2014 select token manually";
    }
  })();
});
document.getElementById("revokeToken").addEventListener("click", () => {
  void (async () => {
    await chrome.storage.sync.set({
      bridgeToken: "",
      bridgeEnabled: false
    });
    document.getElementById("bridgeEnabled").checked = false;
    setBridgeTokenDisplay("");
    document.getElementById("status").textContent = "token revoked";
    await refreshBridgeStatus();
  })();
});
setInterval(() => {
  void refreshBridgeStatus();
}, 3e3);
void loadOptions();
//# sourceMappingURL=options.js.map
