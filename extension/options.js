function g(){let e=new Uint8Array(32);return crypto.getRandomValues(e),Array.from(e,t=>t.toString(16).padStart(2,"0")).join("")}var w="https://github.com/ranjan2829/AskJev/releases/download/v1.7.0/askjev-mcp-1.7.0.tgz";function B(e){let t=(e||"mac").toLowerCase();return t.startsWith("win")?"C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe":t.startsWith("linux")?"/usr/bin/brave-browser":"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"}function k(e){let t={ASKJEV_TOKEN:e.token,ASKJEV_PORT:String(e.port)},n=(e.apiKey||"").trim();return n&&(t.ASKJEV_API_KEY=n,t.TYPESAFE_API_KEY=n,t.ASKJEV_MODE="cdp",t.ASKJEV_BROWSER_BIN=(e.browserBin||"").trim()||B(e.platform)),t}function T(e,t,n="npm"){let o=typeof e=="string"?{token:e,port:t??17373,source:n}:{source:"npm",...e};return{command:"npx",args:["-y",o.source==="github"?w:"askjev-mcp"],env:k(o)}}function l(e,t){return JSON.stringify({mcpServers:{askjev:T(typeof e=="string"?{token:e,port:t??17373}:e)}},null,2)}function b(e){return JSON.stringify(e)}function y(e){let t=k(e);return`import json, os, sys
path = sys.argv[1]
entry = {
  "command": "npx",
  "args": ["-y", "askjev-mcp"],
  "env": {
${Object.entries(t).map(([o,r])=>`  ${b(o)}: ${b(r)},`).join(`
`)}
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
print("Restart Claude Desktop \u2014 Claude starts the bridge for you.")
print("No URL to paste. Local ws://127.0.0.1:%s is automatic." % entry["env"].get("ASKJEV_PORT", "17373"))
`}function I(e){return btoa(unescape(encodeURIComponent(e)))}function f(e,t){let n=typeof e=="string"?{token:e,port:t??17373,platform:"mac"}:{platform:"mac",...e};return`#!/bin/bash
# AskJev \u2014 one-click Claude Desktop connect
# Claude starts the bridge for you (npx -y askjev-mcp). No URL to paste.
set -euo pipefail
CFG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
mkdir -p "$(dirname "$CFG")"
python3 - "$CFG" <<'PY'
${y(n)}PY
echo ""
echo "Done. Quit and reopen Claude Desktop."
read -r -p "Press Enter to close\u2026" _
`}function v(e,t){let n=typeof e=="string"?{token:e,port:t??17373,platform:"linux"}:{platform:"linux",...e};return`#!/usr/bin/env bash
# AskJev \u2014 one-click Claude Desktop connect (Linux)
# Claude starts the bridge for you (npx -y askjev-mcp). No URL to paste.
set -euo pipefail
CFG="\${XDG_CONFIG_HOME:-$HOME/.config}/Claude/claude_desktop_config.json"
mkdir -p "$(dirname "$CFG")"
python3 - "$CFG" <<'PY'
${y(n)}PY
echo ""
echo "Done. Quit and reopen Claude Desktop."
`}function E(e,t){let n=typeof e=="string"?{token:e,port:t??17373,platform:"win"}:{platform:"win",...e};return`@echo off
REM AskJev \u2014 one-click Claude Desktop connect
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
python -c "import base64; open('_askjev_merge.py','w',encoding='utf-8').write(base64.b64decode('${I(y(n))}').decode('utf-8'))"
python _askjev_merge.py "%CFG%"
del /q _askjev_merge.py 2>nul
echo.
echo Done. Quit and reopen Claude Desktop.
pause
`}function u(e,t){let n=new Blob([t],{type:"application/octet-stream"}),o=URL.createObjectURL(n),r=document.createElement("a");r.href=o,r.download=e,r.rel="noopener",document.body.appendChild(r),r.click(),r.remove(),setTimeout(()=>URL.revokeObjectURL(o),2e3)}function c(e){let t=document.getElementById("bridgeTokenDisplay");t.textContent=e||"(none \u2014 generate one)"}function i(e){document.getElementById("status").textContent=e}function a(e,t=!1){let n=document.getElementById("autoStatusLine");n.textContent=e,document.getElementById("bridgeStatus").classList.toggle("armed",t)}async function C(){return Number(document.getElementById("bridgePort").value)||17373}async function M(){let e=await chrome.storage.sync.get(["bridgeToken","bridgePort"]),t=String(e.bridgeToken||"").trim();t||(t=g());let n=Number(document.getElementById("bridgePort").value)||Number(e.bridgePort)||17373;return document.getElementById("bridgeEnabled").checked=!0,document.getElementById("bridgePort").value=String(n),await chrome.storage.sync.set({bridgeToken:t,bridgeEnabled:!0,bridgePort:n}),c(t),{token:t,port:n}}async function d(){let{token:e,port:t}=await M(),n=document.getElementById("apiKey").value.trim(),o=await chrome.storage.sync.get(["apiKey"]),r=n||String(o.apiKey||"").trim()||void 0;return{token:e,port:t,apiKey:r}}async function s(){let e=document.getElementById("bridgeStatus"),t=await chrome.storage.sync.get(["bridgeEnabled","bridgeToken"]),n=t.bridgeEnabled===!0&&!!String(t.bridgeToken||"").trim();try{let o=await chrome.runtime.sendMessage({type:"askjev.bridge.status"});if(o?.ok&&o.bridge){let r=o.bridge;e.textContent=`${r.state}: ${r.detail}`,r.state==="paired"?a("Paired \u2014 Claude/Cursor launched askjev-mcp; bridge is live.",!0):n?a("Bridge armed \u2014 restart Claude/Cursor to auto-launch MCP",!0):a("Bridge off \u2014 click Auto-connect to arm.",!1);return}}catch{}e.textContent=n?"armed (status pending)":"bridge off",a(n?"Bridge armed \u2014 restart Claude/Cursor to auto-launch MCP":"Bridge off \u2014 click Auto-connect to arm.",n)}async function m(e,t){try{await navigator.clipboard.writeText(e),i(t)}catch{i("copy failed \u2014 select text manually")}}async function L(){let e=await chrome.storage.sync.get(null);document.getElementById("apiKey").value=e.apiKey||"",document.getElementById("sensitivity").value=e.sensitivity||"balanced",document.getElementById("keywords").value=(e.customKeywords||[]).join(", "),document.getElementById("allowlist").value=(e.allowlist||[]).join(`
`),document.getElementById("enabled").checked=e.enabled!==!1,document.getElementById("confirmAsk").checked=e.requireConfirmOnAsk===!0,document.getElementById("gateForms").checked=e.gateFormSubmits===!0,document.getElementById("bridgeEnabled").checked=e.bridgeEnabled===!0,document.getElementById("bridgePort").value=String(e.bridgePort||17373),c(e.bridgeToken||""),await s()}document.getElementById("save").addEventListener("click",()=>{(async()=>{let e=document.getElementById("apiKey").value.trim(),t=document.getElementById("sensitivity").value,n=document.getElementById("keywords").value.split(",").map(p=>p.trim()).filter(Boolean),o=document.getElementById("allowlist").value.split(/\n+/).map(p=>p.trim().toLowerCase()).filter(Boolean),r=await C()||17373,h=await chrome.storage.sync.get(["bridgeToken"]);await chrome.storage.sync.set({apiKey:e,sensitivity:t,customKeywords:n,allowlist:o,enabled:document.getElementById("enabled").checked,requireConfirmOnAsk:document.getElementById("confirmAsk").checked,gateFormSubmits:document.getElementById("gateForms").checked,model:"jev-latest",bridgeEnabled:document.getElementById("bridgeEnabled").checked,bridgePort:r,bridgeToken:h.bridgeToken||""}),i("saved"),await s()})()});document.getElementById("autoConnect").addEventListener("click",()=>{(async()=>{let e=await d(),t=l(e);await m(t,e.apiKey?"Auto-connected \u2014 Claude config copied (token + TypeSafe API key)":"Auto-connected \u2014 Claude Desktop config copied (token filled; save TypeSafe API key for multi-step goals)"),a("Bridge armed \u2014 restart Claude/Cursor to auto-launch MCP",!0),await s()})()});document.getElementById("copyClaudeConfig").addEventListener("click",()=>{(async()=>{let e=await d();await m(l(e),"Claude Desktop config copied \u2014 paste into claude_desktop_config.json"),a("Bridge armed \u2014 restart Claude/Cursor to auto-launch MCP",!0),await s()})()});document.getElementById("copyCursorConfig").addEventListener("click",()=>{(async()=>{let e=await d();await m(l(e),"Cursor MCP config copied \u2014 paste into .cursor/mcp.json or Settings \u2192 MCP"),a("Bridge armed \u2014 restart Claude/Cursor to auto-launch MCP",!0),await s()})()});document.getElementById("dlMac").addEventListener("click",()=>{(async()=>{let e=await d();u("AskJev-Connect-Claude.command",f(e)),i("Downloaded macOS helper \u2014 run once, then restart Claude"),a("Bridge armed \u2014 restart Claude/Cursor to auto-launch MCP",!0),await s()})()});document.getElementById("dlWin").addEventListener("click",()=>{(async()=>{let e=await d();u("AskJev-Connect-Claude.bat",E(e)),i("Downloaded Windows helper \u2014 run once, then restart Claude"),a("Bridge armed \u2014 restart Claude/Cursor to auto-launch MCP",!0),await s()})()});document.getElementById("dlLinux").addEventListener("click",()=>{(async()=>{let e=await d();u("AskJev-Connect-Claude.sh",v(e)),i("Downloaded Linux helper \u2014 run once, then restart Claude"),a("Bridge armed \u2014 restart Claude/Cursor to auto-launch MCP",!0),await s()})()});document.getElementById("genToken").addEventListener("click",()=>{(async()=>{let e=g();await chrome.storage.sync.set({bridgeToken:e}),c(e),i("token generated"),await s()})()});document.getElementById("copyToken").addEventListener("click",()=>{(async()=>{let e=await chrome.storage.sync.get(["bridgeToken"]),t=String(e.bridgeToken||"");if(!t){i("no token to copy");return}await m(t,"token copied")})()});document.getElementById("revokeToken").addEventListener("click",()=>{(async()=>(await chrome.storage.sync.set({bridgeToken:"",bridgeEnabled:!1}),document.getElementById("bridgeEnabled").checked=!1,c(""),i("token revoked"),a("Bridge off \u2014 click Auto-connect to arm.",!1),await s()))()});document.getElementById("savePasteToken").addEventListener("click",()=>{(async()=>{let e=document.getElementById("pasteToken").value.trim();if(!e){i("no token to save");return}document.getElementById("bridgeEnabled").checked=!0;let t=await C();await chrome.storage.sync.set({bridgeToken:e,bridgeEnabled:!0,bridgePort:t||17373}),c(e),document.getElementById("pasteToken").value="",i("token saved"),a("Bridge armed \u2014 restart Claude/Cursor to auto-launch MCP",!0),await s()})()});setInterval(()=>{s()},3e3);L();
