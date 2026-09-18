# AskJev

**Talk to Claude in plain English. AskJev drives Brave/Chrome. TypeSafe Jev decides on-page. Guard freezes irreversible clicks.**

No shell. No CDP flags. No paste-JSON rituals. Install the extension, Auto-connect once, reopen Claude, and chat.

Built with [TypeSafe System One](https://typesafe.ai) — page decisions use Jev (Noul / Choice / Score), **not** Claude as the planner.

---

## Setup (phone-simple)

1. **Load the extension** — Chrome or Brave → Extensions → **Load unpacked** → select `extension/` (or install from the store when listed).
2. **Options → paste your TypeSafe API key → Auto-connect** — downloads `AskJev-Connect-Claude.command` (mac) / `.bat` (Windows) / `.sh` (Linux).
3. **Double-click the Connect script once** → **Quit & reopen Claude**.
4. **Chat:** `open example.com and click More information`

That’s it. Claude launches `askjev-mcp` for you. AskJev opens Brave/Chrome over CDP and runs Autopilot. Your API key goes only to `api.typesafe.ai`.

Get a key: [typesafe.ai](https://typesafe.ai) · Docs: [docs.typesafe.ai](https://docs.typesafe.ai/introduction)

---

## Demo (video / wow moment)

After setup, paste this into Claude:

```
Open https://news.ycombinator.com, open the top story, then go to https://www.wikipedia.org,
search for "TypeSafe AI", open the first relevant result, scroll down twice, then open
https://example.com and click More information. When you're done, tell me the page title
on example.com and a one-line summary of what you saw on HN and Wikipedia. If anything
looks irreversible (pay, delete, send, publish), stop and ask me first.
```

Same text lives in [docs/DEMO-PROMPT.md](docs/DEMO-PROMPT.md).

Warm-up: `open example.com and click More information`

---

## How it works

| Piece | Role |
|-------|------|
| **You ↔ Claude** | Natural language. Claude is the MCP *client* — it calls AskJev tools, it does **not** plan each click. |
| **askjev-mcp** | MCP stdio server. Auto-launches Brave/Chrome over CDP and runs the Autopilot loop. |
| **Brave / Chrome** | The browser you see. AskJev drives it. |
| **TypeSafe Jev (System One)** | On-page decisions: next action, target, irreversible score, goal-done. |
| **AskJev Guard** | Freezes pay / delete / send / publish / deploy-class clicks until you confirm. |

```
You → Claude (MCP client) → askjev-mcp (CDP) → Brave/Chrome
                                    ↓
                         TypeSafe Jev System One
```

---

## What you get

| Mode | What happens |
|------|----------------|
| **Autopilot** | Multi-step goals via Claude chat or the extension side panel. Snapshot → Jev next step → act → repeat. |
| **Guard** | Risky clicks held on every page. Overlay: proceed / block / ask. Autopilot stops if the next step looks irreversible. |
| **Connect** | One Auto-connect download writes Claude’s `mcpServers.askjev` (full CDP env + key) and `~/.askjev/api-key`. No daily terminal. |

---

## Advanced

Prefer Auto-connect. These are fallbacks only:

- **More ways to connect** in Options — copy Claude/Cursor JSON, or download mac/win/linux scripts manually.
- **`.mcpb`** Desktop Extension — [docs/MCPB.md](docs/MCPB.md) (legacy pairing-token path).
- **Protocol / security** — [docs/AGENT-BRIDGE.md](docs/AGENT-BRIDGE.md).
- **Dev build:** `npm install && npm run build` · `npm test` · `npm run pack:chrome` · `npm run pack:mcpb`

`askjev-mcp` prefers `npx -y askjev-mcp` (public npm). GitHub Release tarball is the no-registry fallback.

---

## Privacy

- TypeSafe API key: Chrome `storage.sync`, Claude MCP env, and optionally `~/.askjev/api-key` (mode `600`) — never logged, never sent over the agent bridge.
- Pairing token: localhost only (`ws://127.0.0.1`).
- Network: `https://api.typesafe.ai/*` plus pages you browse.
- No AskJev servers. No analytics backend.

---

## Version

**1.7.1** — Easy Auto-connect (download Connect script + always-on CDP Autopilot).

MIT · [ranjan2829/AskJev](https://github.com/ranjan2829/AskJev)
