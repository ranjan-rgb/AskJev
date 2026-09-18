/**
 * One-click connect helpers: Claude Desktop / Cursor MCP JSON + OS installer scripts.
 * Claude launches `npx -y askjev-mcp` over stdio — there is no pasteable URL.
 * The only network path is localhost ws://127.0.0.1:PORT (mcp ↔ extension).
 * When Options has a TypeSafe apiKey, it is written into mcpServers.askjev.env
 * as ASKJEV_API_KEY + TYPESAFE_API_KEY so CDP Autopilot can call System One.
 */

/** Prefer public npm; GitHub Release tarball is the no-registry fallback. */
export const ASKJEV_MCP_TGZ =
  "https://github.com/ranjan2829/AskJev/releases/download/v1.7.0/askjev-mcp-1.7.0.tgz";

/** Default Brave binary preference for ASKJEV_BROWSER_BIN (macOS first). */
export function preferredBraveBin(
  platform?: "mac" | "win" | "linux" | string,
): string {
  const p = (platform || "mac").toLowerCase();
  if (p.startsWith("win")) {
    return "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe";
  }
  if (p.startsWith("linux")) {
    return "/usr/bin/brave-browser";
  }
  return "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
}

export type McpConnectOpts = {
  token: string;
  port: number;
  source?: "npm" | "github";
  /** TypeSafe / AskJev API key from Options — written into MCP env when present. */
  apiKey?: string;
  /** Override browser binary; defaults to Brave preference when apiKey is set (CDP mode). */
  browserBin?: string;
  platform?: "mac" | "win" | "linux" | string;
};

export function buildMcpServerEnv(opts: {
  token: string;
  port: number;
  apiKey?: string;
  browserBin?: string;
  platform?: string;
}): Record<string, string> {
  const env: Record<string, string> = {
    ASKJEV_TOKEN: opts.token,
    ASKJEV_PORT: String(opts.port),
  };
  const key = (opts.apiKey || "").trim();
  if (key) {
    env.ASKJEV_API_KEY = key;
    env.TYPESAFE_API_KEY = key;
    env.ASKJEV_MODE = "cdp";
    env.ASKJEV_BROWSER_BIN =
      (opts.browserBin || "").trim() || preferredBraveBin(opts.platform);
  }
  return env;
}

export function buildMcpServerEntry(
  tokenOrOpts: string | McpConnectOpts,
  port?: number,
  source: "npm" | "github" = "npm",
): Record<string, unknown> {
  const opts: McpConnectOpts =
    typeof tokenOrOpts === "string"
      ? { token: tokenOrOpts, port: port ?? 17373, source }
      : { source: "npm", ...tokenOrOpts };

  const pkg = opts.source === "github" ? ASKJEV_MCP_TGZ : "askjev-mcp";
  return {
    command: "npx",
    args: ["-y", pkg],
    env: buildMcpServerEnv(opts),
  };
}

/** Claude Desktop / Cursor mcpServers block with token (+ optional API key) filled in. */
export function buildClientMcpConfig(
  tokenOrOpts: string | McpConnectOpts,
  port?: number,
): string {
  const opts: McpConnectOpts =
    typeof tokenOrOpts === "string"
      ? { token: tokenOrOpts, port: port ?? 17373 }
      : tokenOrOpts;
  return JSON.stringify(
    {
      mcpServers: {
        askjev: buildMcpServerEntry(opts),
      },
    },
    null,
    2,
  );
}

function pyStringLiteral(s: string): string {
  return JSON.stringify(s);
}

function buildPythonMergeScript(opts: McpConnectOpts): string {
  const env = buildMcpServerEnv(opts);
  const envLines = Object.entries(env)
    .map(([k, v]) => `  ${pyStringLiteral(k)}: ${pyStringLiteral(v)},`)
    .join("\n");
  return `import json, os, sys
path = sys.argv[1]
entry = {
  "command": "npx",
  "args": ["-y", "askjev-mcp"],
  "env": {
${envLines}
  },
}
data = {}
if os.path.isfile(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f) or {}
    except Exception:
        data = {}
if not isinstance(data, dict):
    data = {}
servers = data.get("mcpServers") or {}
if not isinstance(servers, dict):
    servers = {}
servers["askjev"] = entry
data["mcpServers"] = servers
with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)
    f.write("\\n")
print("Wrote askjev into:", path)
print("Restart Claude Desktop — Claude starts the bridge for you.")
print("No URL to paste. Local ws://127.0.0.1:%s is automatic." % entry["env"].get("ASKJEV_PORT", "17373"))
`;
}

function toBase64Utf8(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

/** macOS .command — merges askjev into claude_desktop_config.json */
export function buildClaudeMacCommand(
  tokenOrOpts: string | McpConnectOpts,
  port?: number,
): string {
  const opts: McpConnectOpts =
    typeof tokenOrOpts === "string"
      ? { token: tokenOrOpts, port: port ?? 17373, platform: "mac" }
      : { platform: "mac", ...tokenOrOpts };
  const py = buildPythonMergeScript(opts);
  return `#!/bin/bash
# AskJev — one-click Claude Desktop connect
# Claude starts the bridge for you (npx -y askjev-mcp). No URL to paste.
set -euo pipefail
CFG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
mkdir -p "$(dirname "$CFG")"
python3 - "$CFG" <<'PY'
${py}PY
echo ""
echo "Done. Quit and reopen Claude Desktop."
read -r -p "Press Enter to close…" _
`;
}

/** Linux .sh — merges askjev into ~/.config/Claude/claude_desktop_config.json */
export function buildClaudeLinuxSh(
  tokenOrOpts: string | McpConnectOpts,
  port?: number,
): string {
  const opts: McpConnectOpts =
    typeof tokenOrOpts === "string"
      ? { token: tokenOrOpts, port: port ?? 17373, platform: "linux" }
      : { platform: "linux", ...tokenOrOpts };
  const py = buildPythonMergeScript(opts);
  return `#!/usr/bin/env bash
# AskJev — one-click Claude Desktop connect (Linux)
# Claude starts the bridge for you (npx -y askjev-mcp). No URL to paste.
set -euo pipefail
CFG="\${XDG_CONFIG_HOME:-\$HOME/.config}/Claude/claude_desktop_config.json"
mkdir -p "$(dirname "$CFG")"
python3 - "$CFG" <<'PY'
${py}PY
echo ""
echo "Done. Quit and reopen Claude Desktop."
`;
}

/** Windows .bat — merges askjev into %APPDATA%\\Claude\\claude_desktop_config.json */
export function buildClaudeWinBat(
  tokenOrOpts: string | McpConnectOpts,
  port?: number,
): string {
  const opts: McpConnectOpts =
    typeof tokenOrOpts === "string"
      ? { token: tokenOrOpts, port: port ?? 17373, platform: "win" }
      : { platform: "win", ...tokenOrOpts };
  const b64 = toBase64Utf8(buildPythonMergeScript(opts));
  return `@echo off
REM AskJev — one-click Claude Desktop connect
REM Claude starts the bridge for you (npx -y askjev-mcp). No URL to paste.
setlocal
set "CFG=%APPDATA%\\Claude\\claude_desktop_config.json"
if not exist "%APPDATA%\\Claude" mkdir "%APPDATA%\\Claude"
where python >nul 2>&1
if errorlevel 1 (
  echo Python is required to merge Claude config. Install Python 3, then re-run.
  echo Or paste the Claude Desktop JSON from AskJev Options instead.
  pause
  exit /b 1
)
python -c "import base64; open('_askjev_merge.py','w',encoding='utf-8').write(base64.b64decode('${b64}').decode('utf-8'))"
python _askjev_merge.py "%CFG%"
del /q _askjev_merge.py 2>nul
echo.
echo Done. Quit and reopen Claude Desktop.
pause
`;
}

export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
