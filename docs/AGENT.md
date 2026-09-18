# AskJev agent notes

Use this when helping Ranjan configure or extend AskJev.

## Product

AskJev is a Brave/Chrome MV3 extension (TypeScript → `extension/`) plus the MCP package (`mcp/` → `askjev-mcp`).

Modes:

1. **CDP Autopilot (product path)** — `askjev-mcp` drives Brave/Chrome over Playwright/CDP. `askjev_do` goal → snapshot → System One fan-out → act → loop (`mcp/src/jev-autopilot.ts`). Stops on DONE/BLOCKED, `ASKJEV_MAX_STEPS` (25), or irreversible ≥ 0.65. Needs a TypeSafe API key or it fails loudly (`missing_api_key`).
2. **Extension Autopilot** — side panel goal → DOM snapshot → TypeSafe Jev Choice for next action → execute → loop. Same 0.65 gate.
3. **Guard** — intercepts risky clicks in-page; one System One call returns `irreversible` (noul), `risk` (score), `action` (choice: proceed|block|ask).
4. **Agent bridge (legacy)** — `askjev-mcp` stdio MCP + localhost WebSocket; extension dials `ws://127.0.0.1:17373` with a pairing token. Same Guard threshold. Only opened with `ASKJEV_MODE=bridge` (or `auto` + a ≥64-char token) — **not** in the default `cdp` mode. See [AGENT-BRIDGE.md](./AGENT-BRIDGE.md).

**AI connection (Jev):** only `POST https://api.typesafe.ai/v1/systemone` with the user’s TypeSafe API key. **Not Claude-as-LLM for decisions** — Claude/Cursor are MCP *clients* that drive AskJev; page decisions come from TypeSafe Jev, called by the extension (`src/jev.ts`) and by `askjev-mcp` (`mcp/src/jev-client.ts`). No AskJev backend.

## Configure for the user

1. Load unpacked → `extension/` (built output is committed; re-run `npm run build` only after editing `src/`)
2. Options → TypeSafe API key → **Auto-connect** → double-click the downloaded Connect script → quit & reopen Claude. That is the whole end-user path; no terminal (see AGENT-BRIDGE.md).
3. Sensitivity: `chill` | `balanced` | `paranoid` (default `balanced`)
4. Custom keywords + allowlist (allowlist = opt-out only)
5. Popup → Open Autopilot for extension-side goal-driven runs

## Extend safely

- Keep Jev questions atomic (TypeSafe guidance)
- Never log or commit API keys or pairing tokens
- Prefer allowlist over weakening global keywords
- Autopilot **and** bridge `act` must keep using the irreversible noul gate — do not bypass Guard for pay/delete/send-class steps
- Agents automating the browser should use the bridge / Autopilot paths, not raw clicks around them
- Bridge must remain `127.0.0.1` + token; never bind `0.0.0.0`

## Demo

- Guard: `npm run demo` → Pay / Delete / Send on localhost
- Autopilot: side panel goal on any site (start low-risk)
- CDP Autopilot: from Claude, `open example.com and click More information` (see [DEMO-PROMPT.md](./DEMO-PROMPT.md))
- Legacy bridge: enable in Options, run `ASKJEV_MODE=bridge ASKJEV_TOKEN=… askjev-mcp`, call `askjev_status` from an MCP client
