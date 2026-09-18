import { generateBridgeToken } from "./defaults.js";
import {
  buildClientMcpConfig,
  buildClaudeLinuxSh,
  buildClaudeMacCommand,
  buildClaudeWinBat,
  detectConnectPlatform,
  downloadTextFile,
} from "./connect-helpers.js";

function setBridgeTokenDisplay(token: string): void {
  const el = document.getElementById("bridgeTokenDisplay") as HTMLElement;
  el.textContent = token || "(none — generate one)";
}

function setStatus(msg: string): void {
  (document.getElementById("status") as HTMLElement).textContent = msg;
}

function setAutoLine(msg: string, armed = false): void {
  const line = document.getElementById("autoStatusLine") as HTMLElement;
  line.textContent = msg;
  const pill = document.getElementById("bridgeStatus") as HTMLElement;
  pill.classList.toggle("armed", armed);
}

async function getBridgePort(): Promise<number> {
  const raw = Number(
    (document.getElementById("bridgePort") as HTMLInputElement).value,
  );
  return raw || 17373;
}

async function ensureTokenAndArm(): Promise<{ token: string; port: number }> {
  const cur = await chrome.storage.sync.get(["bridgeToken", "bridgePort"]);
  let token = String(cur.bridgeToken || "").trim();
  if (!token) {
    token = generateBridgeToken();
  }
  const port =
    Number((document.getElementById("bridgePort") as HTMLInputElement).value) ||
    Number(cur.bridgePort) ||
    17373;
  (document.getElementById("bridgeEnabled") as HTMLInputElement).checked = true;
  (document.getElementById("bridgePort") as HTMLInputElement).value =
    String(port);
  await chrome.storage.sync.set({
    bridgeToken: token,
    bridgeEnabled: true,
    bridgePort: port,
  });
  setBridgeTokenDisplay(token);
  return { token, port };
}

async function getConnectOpts(): Promise<{
  token: string;
  port: number;
  apiKey?: string;
}> {
  const { token, port } = await ensureTokenAndArm();
  const fromInput = (
    document.getElementById("apiKey") as HTMLInputElement
  ).value.trim();
  const stored = await chrome.storage.sync.get(["apiKey"]);
  const apiKey = fromInput || String(stored.apiKey || "").trim() || undefined;
  return { token, port, apiKey };
}

/** Persist typed API key so Auto-connect / Save share the same happy path. */
async function saveApiKeyIfTyped(): Promise<string | undefined> {
  const fromInput = (
    document.getElementById("apiKey") as HTMLInputElement
  ).value.trim();
  if (fromInput) {
    await chrome.storage.sync.set({ apiKey: fromInput });
  }
  return fromInput || undefined;
}

function downloadConnectScript(opts: {
  token: string;
  port: number;
  apiKey?: string;
}): { filename: string } {
  const platform = detectConnectPlatform();
  if (platform === "win") {
    downloadTextFile("AskJev-Connect-Claude.bat", buildClaudeWinBat(opts));
    return { filename: "AskJev-Connect-Claude.bat" };
  }
  if (platform === "linux") {
    downloadTextFile("AskJev-Connect-Claude.sh", buildClaudeLinuxSh(opts));
    return { filename: "AskJev-Connect-Claude.sh" };
  }
  downloadTextFile(
    "AskJev-Connect-Claude.command",
    buildClaudeMacCommand(opts),
  );
  return { filename: "AskJev-Connect-Claude.command" };
}

async function refreshBridgeStatus(): Promise<void> {
  const el = document.getElementById("bridgeStatus") as HTMLElement;
  const s = await chrome.storage.sync.get(["bridgeEnabled", "bridgeToken"]);
  const armed =
    s.bridgeEnabled === true && Boolean(String(s.bridgeToken || "").trim());
  try {
    const resp = await chrome.runtime.sendMessage({
      type: "askjev.bridge.status",
    });
    if (resp?.ok && resp.bridge) {
      const b = resp.bridge as { state: string; detail: string };
      el.textContent = `${b.state}: ${b.detail}`;
      if (b.state === "paired") {
        setAutoLine(
          "Paired — Claude/Cursor launched askjev-mcp; bridge is live.",
          true,
        );
      } else if (armed) {
        setAutoLine(
          "Bridge armed — double-click Connect script, then quit & reopen Claude",
          true,
        );
      } else {
        setAutoLine("Bridge off — click Auto-connect to arm.", false);
      }
      return;
    }
  } catch {
    /* ignore */
  }
  el.textContent = armed ? "armed (status pending)" : "bridge off";
  setAutoLine(
    armed
      ? "Bridge armed — double-click Connect script, then quit & reopen Claude"
      : "Bridge off — click Auto-connect to arm.",
    armed,
  );
}

async function copyText(text: string, okMsg: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    setStatus(okMsg);
  } catch {
    setStatus("copy failed — select text manually");
  }
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
    s.requireConfirmOnAsk === true;
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
    const bridgePort = (await getBridgePort()) || 17373;
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
    setStatus("saved");
    await refreshBridgeStatus();
  })();
});

document.getElementById("autoConnect")!.addEventListener("click", () => {
  void (async () => {
    await saveApiKeyIfTyped();
    const opts = await getConnectOpts();
    const { filename } = downloadConnectScript(opts);
    const cfg = buildClientMcpConfig(opts);
    try {
      await navigator.clipboard.writeText(cfg);
    } catch {
      /* JSON backup is optional */
    }
    let msg =
      "Downloaded Connect script — double-click it once, then quit & reopen Claude. Then chat normally.";
    if (!opts.apiKey) {
      msg =
        "Save TypeSafe API key above first — multi-step Autopilot needs it. " +
        msg;
    }
    setStatus(msg);
    setAutoLine(
      `Downloaded ${filename} — double-click once, then quit & reopen Claude`,
      true,
    );
    await refreshBridgeStatus();
  })();
});

document.getElementById("copyClaudeConfig")!.addEventListener("click", () => {
  void (async () => {
    await saveApiKeyIfTyped();
    const opts = await getConnectOpts();
    await copyText(
      buildClientMcpConfig(opts),
      "Claude Desktop config copied — paste into claude_desktop_config.json (Advanced)",
    );
    setAutoLine(
      "Bridge armed — prefer Auto-connect script over paste-JSON",
      true,
    );
    await refreshBridgeStatus();
  })();
});

document.getElementById("copyCursorConfig")!.addEventListener("click", () => {
  void (async () => {
    await saveApiKeyIfTyped();
    const opts = await getConnectOpts();
    await copyText(
      buildClientMcpConfig(opts),
      "Cursor MCP config copied — paste into .cursor/mcp.json or Settings → MCP",
    );
    setAutoLine(
      "Bridge armed — prefer Auto-connect script over paste-JSON",
      true,
    );
    await refreshBridgeStatus();
  })();
});

document.getElementById("dlMac")!.addEventListener("click", () => {
  void (async () => {
    await saveApiKeyIfTyped();
    const opts = await getConnectOpts();
    downloadTextFile(
      "AskJev-Connect-Claude.command",
      buildClaudeMacCommand(opts),
    );
    setStatus("Downloaded macOS helper — run once, then restart Claude");
    setAutoLine(
      "Bridge armed — double-click Connect script, then quit & reopen Claude",
      true,
    );
    await refreshBridgeStatus();
  })();
});

document.getElementById("dlWin")!.addEventListener("click", () => {
  void (async () => {
    await saveApiKeyIfTyped();
    const opts = await getConnectOpts();
    downloadTextFile("AskJev-Connect-Claude.bat", buildClaudeWinBat(opts));
    setStatus("Downloaded Windows helper — run once, then restart Claude");
    setAutoLine(
      "Bridge armed — double-click Connect script, then quit & reopen Claude",
      true,
    );
    await refreshBridgeStatus();
  })();
});

document.getElementById("dlLinux")!.addEventListener("click", () => {
  void (async () => {
    await saveApiKeyIfTyped();
    const opts = await getConnectOpts();
    downloadTextFile("AskJev-Connect-Claude.sh", buildClaudeLinuxSh(opts));
    setStatus("Downloaded Linux helper — run once, then restart Claude");
    setAutoLine(
      "Bridge armed — double-click Connect script, then quit & reopen Claude",
      true,
    );
    await refreshBridgeStatus();
  })();
});

document.getElementById("genToken")!.addEventListener("click", () => {
  void (async () => {
    const token = generateBridgeToken();
    await chrome.storage.sync.set({ bridgeToken: token });
    setBridgeTokenDisplay(token);
    setStatus("token generated");
    await refreshBridgeStatus();
  })();
});

document.getElementById("copyToken")!.addEventListener("click", () => {
  void (async () => {
    const s = await chrome.storage.sync.get(["bridgeToken"]);
    const token = String(s.bridgeToken || "");
    if (!token) {
      setStatus("no token to copy");
      return;
    }
    await copyText(token, "token copied");
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
    setStatus("token revoked");
    setAutoLine("Bridge off — click Auto-connect to arm.", false);
    await refreshBridgeStatus();
  })();
});

document.getElementById("savePasteToken")!.addEventListener("click", () => {
  void (async () => {
    const token = (
      document.getElementById("pasteToken") as HTMLInputElement
    ).value.trim();
    if (!token) {
      setStatus("no token to save");
      return;
    }
    (document.getElementById("bridgeEnabled") as HTMLInputElement).checked =
      true;
    const port = await getBridgePort();
    await chrome.storage.sync.set({
      bridgeToken: token,
      bridgeEnabled: true,
      bridgePort: port || 17373,
    });
    setBridgeTokenDisplay(token);
    (document.getElementById("pasteToken") as HTMLInputElement).value = "";
    setStatus("token saved");
    setAutoLine(
      "Bridge armed — double-click Connect script, then quit & reopen Claude",
      true,
    );
    await refreshBridgeStatus();
  })();
});

setInterval(() => {
  void refreshBridgeStatus();
}, 3000);

void loadOptions();
