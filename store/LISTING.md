# Chrome Web Store — AskJev

**Name:** AskJev  
**Short description (132 chars max):**  
Jev autopilot for any site + guard on irreversible clicks. Connect Claude/Cursor via MCP — localhost only.

**Category:** Productivity  

**Language:** English  

## Detailed description

AskJev turns TypeSafe’s Jev (System One) into a browser autopilot and a safety brake.

AUTOPILOT — Open the side panel, type a goal, and Jev picks the next click, type, or scroll. AskJev executes it on the live page. Works on every website.

GUARD — When you hit Pay, Delete, Send, Approve, Deploy, and similar high-impact controls, AskJev freezes the click and asks Jev whether to proceed, block, or ask you. Autopilot also stops if the next step looks irreversible.

AGENT BRIDGE — Connect Claude Desktop or Cursor with one-click Auto-connect in Options. Claude launches the local askjev-mcp bridge (npm). Traffic stays on 127.0.0.1 with a pairing token. Your TypeSafe API key never leaves the extension except to api.typesafe.ai.

Not a chat LLM inside the browser. Fast structured decisions from TypeSafe Jev. Built for real production use worldwide.

Setup:
1. Install AskJev
2. Options → paste TypeSafe API key
3. Popup → Open Autopilot — or Options → Auto-connect for Claude

Privacy: Key in Chrome sync. Page context only to api.typesafe.ai when deciding. Agent bridge is localhost only. No AskJev servers.

Support: https://github.com/ranjan2829/AskJev  
Privacy policy: open extension privacy.html or https://github.com/ranjan2829/AskJev/blob/main/extension/privacy.html

## Single purpose
Help users automate browser tasks safely with TypeSafe Jev decisions and optional MCP agent control.

## Permission justifications (for CWS form)
- storage: save TypeSafe API key, settings, pairing token, stats
- alarms: bridge reconnect / keepalive
- sidePanel: Autopilot mission UI
- activeTab / tabs: run Autopilot on the active tab; open docs
- host api.typesafe.ai: System One decisions
- host http/https all: content script Guard + Autopilot on every site (user allowlists opt-out)
- host ws://127.0.0.1 / localhost: optional agent bridge to local askjev-mcp only

## Screenshots needed (you take on MacBook)
1. Popup Armed / mission readout
2. Autopilot side panel with a goal
3. Guard overlay on a Pay/Delete click
4. Options Auto-connect section
