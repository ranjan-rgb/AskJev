# Chrome Web Store listing draft

**Name:** AskJev  
**Short:** Jev autopilot for any site — with a guard on irreversible clicks. MCP bridge for Claude/Cursor.  
**Category:** Productivity  

**Description:**
AskJev turns TypeSafe’s Jev (System One) into a browser autopilot and a safety brake — and optionally lets Claude Desktop or Cursor drive the same Autopilot over a localhost MCP bridge.

**Autopilot** — open the side panel, type a goal, and Jev picks the next click, type, or scroll from the live page. AskJev executes it. Works on every website.

**Guard** — when you hit Pay, Delete, Send, Approve, Deploy, and similar high-impact controls, AskJev freezes the click and asks Jev: is this irreversible, how risky is it, and should we proceed, block, or ask you? Autopilot and the agent bridge also stop if the next step looks irreversible.

**Agent bridge** — generate a pairing token in Options, run `npx askjev-mcp`, and connect any MCP client. Traffic stays on 127.0.0.1. Your TypeSafe API key never leaves the extension.

Page decisions come from TypeSafe Jev (structured Choice / Score / Noul) — not a chat LLM inside AskJev. Claude/Cursor are optional MCP clients. Your API key stays in Chrome storage and is sent only to api.typesafe.ai. No AskJev servers.

**Privacy:** Key in Chrome sync. Bridge token on localhost only. Context only to api.typesafe.ai. No AskJev backend.
