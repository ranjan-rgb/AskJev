function p(){let e=new Uint8Array(32);return crypto.getRandomValues(e),Array.from(e,t=>t.toString(16).padStart(2,"0")).join("")}var h="https://github.com/ranjan2829/AskJev/releases/download/v1.5.0/askjev-mcp-1.5.0.tgz";function w(e,t,n="npm"){return{command:"npx",args:["-y",n==="github"?h:"askjev-mcp"],env:{ASKJEV_TOKEN:e,ASKJEV_PORT:String(t)}}}function l(e,t){return JSON.stringify({mcpServers:{askjev:w(e,t)}},null,2)}function y(e){return JSON.stringify(e)}function b(e,t){return`import json, os, sys
path = sys.argv[1]
token = ${y(e)}
port = ${y(String(t))}
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
print("Restart Claude Desktop \u2014 Claude starts the bridge for you.")
print("No URL to paste. Local ws://127.0.0.1:%s is automatic." % port)
`}function T(e){return btoa(unescape(encodeURIComponent(e)))}function k(e,t){return`#!/bin/bash
# AskJev \u2014 one-click Claude Desktop connect
# Claude starts the bridge for you (npx -y askjev-mcp). No URL to paste.
set -euo pipefail
CFG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
mkdir -p "$(dirname "$CFG")"
python3 - "$CFG" <<'PY'
${b(e,t)}PY
echo ""
echo "Done. Quit and reopen Claude Desktop."
read -r -p "Press Enter to close\u2026" _
`}function E(e,t){return`#!/usr/bin/env bash
# AskJev \u2014 one-click Claude Desktop connect (Linux)
# Claude starts the bridge for you (npx -y askjev-mcp). No URL to paste.
set -euo pipefail
CFG="\${XDG_CONFIG_HOME:-$HOME/.config}/Claude/claude_desktop_config.json"
mkdir -p "$(dirname "$CFG")"
python3 - "$CFG" <<'PY'
${b(e,t)}PY
echo ""
echo "Done. Quit and reopen Claude Desktop."
`}function v(e,t){return`@echo off
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
python -c "import base64; open('_askjev_merge.py','w',encoding='utf-8').write(base64.b64decode('${T(b(e,t))}').decode('utf-8'))"
python _askjev_merge.py "%CFG%"
del /q _askjev_merge.py 2>nul
echo.
echo Done. Quit and reopen Claude Desktop.
pause
`}function u(e,t){let n=new Blob([t],{type:"application/octet-stream"}),i=URL.createObjectURL(n),o=document.createElement("a");o.href=i,o.download=e,o.rel="noopener",document.body.appendChild(o),o.click(),o.remove(),setTimeout(()=>URL.revokeObjectURL(i),2e3)}function c(e){let t=document.getElementById("bridgeTokenDisplay");t.textContent=e||"(none \u2014 generate one)"}function s(e){document.getElementById("status").textContent=e}function r(e,t=!1){let n=document.getElementById("autoStatusLine");n.textContent=e,document.getElementById("bridgeStatus").classList.toggle("armed",t)}async function f(){return Number(document.getElementById("bridgePort").value)||17373}async function d(){let e=await chrome.storage.sync.get(["bridgeToken","bridgePort"]),t=String(e.bridgeToken||"").trim();t||(t=p());let n=Number(document.getElementById("bridgePort").value)||Number(e.bridgePort)||17373;return document.getElementById("bridgeEnabled").checked=!0,document.getElementById("bridgePort").value=String(n),await chrome.storage.sync.set({bridgeToken:t,bridgeEnabled:!0,bridgePort:n}),c(t),{token:t,port:n}}async function a(){let e=document.getElementById("bridgeStatus"),t=await chrome.storage.sync.get(["bridgeEnabled","bridgeToken"]),n=t.bridgeEnabled===!0&&!!String(t.bridgeToken||"").trim();try{let i=await chrome.runtime.sendMessage({type:"askjev.bridge.status"});if(i?.ok&&i.bridge){let o=i.bridge;e.textContent=`${o.state}: ${o.detail}`,o.state==="paired"?r("Paired \u2014 Claude/Cursor launched askjev-mcp; bridge is live.",!0):n?r("Bridge armed \u2014 restart Claude/Cursor to auto-launch MCP",!0):r("Bridge off \u2014 click Auto-connect to arm.",!1);return}}catch{}e.textContent=n?"armed (status pending)":"bridge off",r(n?"Bridge armed \u2014 restart Claude/Cursor to auto-launch MCP":"Bridge off \u2014 click Auto-connect to arm.",n)}async function m(e,t){try{await navigator.clipboard.writeText(e),s(t)}catch{s("copy failed \u2014 select text manually")}}async function B(){let e=await chrome.storage.sync.get(null);document.getElementById("apiKey").value=e.apiKey||"",document.getElementById("sensitivity").value=e.sensitivity||"balanced",document.getElementById("keywords").value=(e.customKeywords||[]).join(", "),document.getElementById("allowlist").value=(e.allowlist||[]).join(`
`),document.getElementById("enabled").checked=e.enabled!==!1,document.getElementById("confirmAsk").checked=e.requireConfirmOnAsk!==!1,document.getElementById("gateForms").checked=e.gateFormSubmits===!0,document.getElementById("bridgeEnabled").checked=e.bridgeEnabled===!0,document.getElementById("bridgePort").value=String(e.bridgePort||17373),c(e.bridgeToken||""),await a()}document.getElementById("save").addEventListener("click",()=>{(async()=>{let e=document.getElementById("apiKey").value.trim(),t=document.getElementById("sensitivity").value,n=document.getElementById("keywords").value.split(",").map(g=>g.trim()).filter(Boolean),i=document.getElementById("allowlist").value.split(/\n+/).map(g=>g.trim().toLowerCase()).filter(Boolean),o=await f()||17373,C=await chrome.storage.sync.get(["bridgeToken"]);await chrome.storage.sync.set({apiKey:e,sensitivity:t,customKeywords:n,allowlist:i,enabled:document.getElementById("enabled").checked,requireConfirmOnAsk:document.getElementById("confirmAsk").checked,gateFormSubmits:document.getElementById("gateForms").checked,model:"jev-latest",bridgeEnabled:document.getElementById("bridgeEnabled").checked,bridgePort:o,bridgeToken:C.bridgeToken||""}),s("saved"),await a()})()});document.getElementById("autoConnect").addEventListener("click",()=>{(async()=>{let{token:e,port:t}=await d(),n=l(e,t);await m(n,"Auto-connected \u2014 Claude Desktop config copied (token filled)"),r("Bridge armed \u2014 restart Claude/Cursor to auto-launch MCP",!0),await a()})()});document.getElementById("copyClaudeConfig").addEventListener("click",()=>{(async()=>{let{token:e,port:t}=await d();await m(l(e,t),"Claude Desktop config copied \u2014 paste into claude_desktop_config.json"),r("Bridge armed \u2014 restart Claude/Cursor to auto-launch MCP",!0),await a()})()});document.getElementById("copyCursorConfig").addEventListener("click",()=>{(async()=>{let{token:e,port:t}=await d();await m(l(e,t),"Cursor MCP config copied \u2014 paste into .cursor/mcp.json or Settings \u2192 MCP"),r("Bridge armed \u2014 restart Claude/Cursor to auto-launch MCP",!0),await a()})()});document.getElementById("dlMac").addEventListener("click",()=>{(async()=>{let{token:e,port:t}=await d();u("AskJev-Connect-Claude.command",k(e,t)),s("Downloaded macOS helper \u2014 run once, then restart Claude"),r("Bridge armed \u2014 restart Claude/Cursor to auto-launch MCP",!0),await a()})()});document.getElementById("dlWin").addEventListener("click",()=>{(async()=>{let{token:e,port:t}=await d();u("AskJev-Connect-Claude.bat",v(e,t)),s("Downloaded Windows helper \u2014 run once, then restart Claude"),r("Bridge armed \u2014 restart Claude/Cursor to auto-launch MCP",!0),await a()})()});document.getElementById("dlLinux").addEventListener("click",()=>{(async()=>{let{token:e,port:t}=await d();u("AskJev-Connect-Claude.sh",E(e,t)),s("Downloaded Linux helper \u2014 run once, then restart Claude"),r("Bridge armed \u2014 restart Claude/Cursor to auto-launch MCP",!0),await a()})()});document.getElementById("genToken").addEventListener("click",()=>{(async()=>{let e=p();await chrome.storage.sync.set({bridgeToken:e}),c(e),s("token generated"),await a()})()});document.getElementById("copyToken").addEventListener("click",()=>{(async()=>{let e=await chrome.storage.sync.get(["bridgeToken"]),t=String(e.bridgeToken||"");if(!t){s("no token to copy");return}await m(t,"token copied")})()});document.getElementById("revokeToken").addEventListener("click",()=>{(async()=>(await chrome.storage.sync.set({bridgeToken:"",bridgeEnabled:!1}),document.getElementById("bridgeEnabled").checked=!1,c(""),s("token revoked"),r("Bridge off \u2014 click Auto-connect to arm.",!1),await a()))()});document.getElementById("savePasteToken").addEventListener("click",()=>{(async()=>{let e=document.getElementById("pasteToken").value.trim();if(!e){s("no token to save");return}document.getElementById("bridgeEnabled").checked=!0;let t=await f();await chrome.storage.sync.set({bridgeToken:e,bridgeEnabled:!0,bridgePort:t||17373}),c(e),document.getElementById("pasteToken").value="",s("token saved"),r("Bridge armed \u2014 restart Claude/Cursor to auto-launch MCP",!0),await a()})()});setInterval(()=>{a()},3e3);B();
