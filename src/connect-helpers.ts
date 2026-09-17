/**
 * One-click connect helpers: Claude Desktop / Cursor MCP JSON + OS installer scripts.
 * Claude launches `npx -y askjev-mcp` over stdio — there is no pasteable URL.
 * The only network path is localhost ws://127.0.0.1:PORT (mcp ↔ extension).
 */

export function buildMcpServerEntry(
  token: string,
  port: number,
): Record<string, unknown> {
  return {
    command: "npx",
    args: ["-y", "askjev-mcp"],
    env: {
      ASKJEV_TOKEN: token,
      ASKJEV_PORT: String(port),
    },
  };
}

/** Claude Desktop / Cursor mcpServers block with token filled in. */
export function buildClientMcpConfig(token: string, port: number): string {
  return JSON.stringify(
    {
      mcpServers: {
        askjev: buildMcpServerEntry(token, port),
      },
    },
    null,
    2,
  );
}

function pyStringLiteral(s: string): string {
  return JSON.stringify(s);
}

/** Shared Python merge snippet (token/port injected as Python literals). */
function pythonMergeScript(token: string, port: number): string {
  return `import json, os, sys
path = sys.argv[1]
token = ${pyStringLiteral(token)}
port = ${pyStringLiteral(String(port))}
entry = {
  "command": "npx",
  "args": ["-y", "askjev-mcp"],
  "env": {"ASKJEV_TOKEN": token, "ASKJEV_PORT": port},
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
print("No URL to paste. Local ws://127.0.0.1:%s is automatic." % port)
`;
}

function toBase64Utf8(text: string): string {
  // Token/config are ASCII-safe; encodeURIComponent covers any edge cases.
  return btoa(unescape(encodeURIComponent(text)));
}

/** macOS .command — merges askjev into claude_desktop_config.json */
export function buildClaudeMacCommand(token: string, port: number): string {
  const py = pythonMergeScript(token, port);
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
export function buildClaudeLinuxSh(token: string, port: number): string {
  const py = pythonMergeScript(token, port);
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
export function buildClaudeWinBat(token: string, port: number): string {
  const b64 = toBase64Utf8(pythonMergeScript(token, port));
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
