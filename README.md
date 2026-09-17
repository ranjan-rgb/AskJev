# AskJev

**Jev autopilot for any website — plus a guard on irreversible clicks.**  
**Optional MCP agent bridge** so Claude Desktop, Cursor, or any MCP client can drive the browser safely.

Production Chrome / Brave MV3 extension (TypeScript). Type a goal and Jev drives the page. High-impact clicks still get frozen and judged before they land. Agents connect over localhost with a pairing token — your TypeSafe key never leaves the extension.

Built for worldwide use: every site by default (`<all_urls>`), cheap System One decisions, typed DOM actions, human override. Not a Flights toy demo.

## What it is

| Mode | Where | What happens |
|------|--------|--------------|
| **Autopilot** | Side panel | You type a goal. AskJev snapshots interactive elements, asks Jev for the next action (`CLICK` / `TYPE_TEXT` / `SELECT` / `SCROLL_*` / `WAIT` / `DONE` / `BLOCKED`), executes it, repeats (max 20 steps). |
| **Guard** | Every page | Risky clicks (pay, delete, send, publish, deploy, …) are held. Jev scores irreversible + risk and chooses `proceed` / `block` / `ask`. Overlay lets you confirm. Autopilot **stops** if the next step looks irreversible (≥ 0.65). |
| **Agent bridge** | MCP + Options | Run `npx askjev-mcp` with a pairing token. Claude/Cursor get `askjev_*` tools. Extension dials `ws://127.0.0.1:17373`. Same Guard on acts. |

Allowlist is the only opt-out. There is no AskJev backend.

## Connect an MCP client (3 steps)

1. **Options → Agent bridge → Generate token → Enable → Save**
2. **`ASKJEV_TOKEN=<token> npx askjev-mcp`**
3. **Paste Claude Desktop / Cursor MCP config** (token in `env`) — full snippets in [docs/AGENT-BRIDGE.md](docs/AGENT-BRIDGE.md)

## How AI connects

**Page decisions** use **TypeSafe Jev** (System One) only — not Claude/ChatGPT as the decision model:

```http
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <your TypeSafe API key>
```

**Claude / Cursor** can be MCP *clients* of AskJev: they call tools; the extension still asks Jev before irreversible work. Your API key lives in Chrome sync storage and is sent only to `api.typesafe.ai`. The pairing token stays on localhost.

Docs: [docs.typesafe.ai](https://docs.typesafe.ai/introduction) · Bridge: [docs/AGENT-BRIDGE.md](docs/AGENT-BRIDGE.md)

## Setup

```bash
npm install && npm run build
```

1. Chrome or Brave → Extensions → **Load unpacked** → select `extension/`
2. Options → paste your **TypeSafe** API key
3. Popup → **Open Autopilot** (or open the side panel)
4. Optional Guard demo: `npm run demo` → open `http://localhost:8765` → click Pay / Delete / Send
5. Optional agent bridge: see [docs/AGENT-BRIDGE.md](docs/AGENT-BRIDGE.md)

## Project layout

```
src/                 Extension TypeScript source
  background.ts      Guard decide + Autopilot loop + bridge client
  bridge.ts          Localhost WebSocket client (extension → mcp)
  content.ts         Click gate + DOM snapshot/execute
  autopilot-jev.ts   Jev next-step Choice
  dom.ts             Interactive element snapshot + actions
  sidepanel.ts       Autopilot UI
  jev.ts             System One client (Guard)
mcp/                 Publishable askjev-mcp (stdio MCP + WS server)
extension/           Built MV3 package (load this)
demo/                Local checkout page for Guard
store/LISTING.md     Chrome Web Store copy draft
docs/AGENT.md        Notes for agents extending AskJev
docs/AGENT-BRIDGE.md Protocol, security, Claude/Cursor snippets
```

## Build / ship

```bash
npm run typecheck
npm run build          # → extension/ + mcp/dist
npm run pack           # zip for store (see store/)
```

Current version: **1.4.0**

`askjev-mcp` is shippable on npm (`ranjan3129`) but is **not** published unless you ask.

## Privacy

- API key: Chrome `storage.sync` only (never over the agent bridge)
- Pairing token: Chrome sync + your local MCP env
- Network: `https://api.typesafe.ai/*` plus pages you browse; bridge is `127.0.0.1` only
- No AskJev servers, no analytics backend

## License

MIT
