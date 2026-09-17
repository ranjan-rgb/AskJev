# AskJev agent notes

Use this when helping Ranjan configure or extend AskJev.

## Product

AskJev is a Chrome/Brave MV3 extension (TypeScript → `extension/`) plus an optional MCP package (`mcp/` → `askjev-mcp`).

Three modes:

1. **Autopilot** — side panel goal → DOM snapshot → TypeSafe Jev Choice for next action → execute → loop. Stops on DONE/BLOCKED, max steps, or irreversible ≥ 0.65.
2. **Guard** — intercepts risky clicks; one System One call returns `irreversible` (noul), `risk` (score), `action` (choice: proceed|block|ask).
3. **Agent bridge** — `askjev-mcp` stdio MCP + localhost WebSocket; Claude/Cursor call `askjev_*` tools; extension dials `ws://127.0.0.1:17373` with a pairing token. Same Guard threshold. See [AGENT-BRIDGE.md](./AGENT-BRIDGE.md).

**AI connection (Jev):** only `POST https://api.typesafe.ai/v1/systemone` with the user’s TypeSafe API key. **Not Claude-as-LLM for decisions** — Claude/Cursor are MCP *clients* that drive AskJev; page decisions still come from TypeSafe Jev inside the extension. No AskJev backend.

## Configure for the user

1. Load unpacked → `extension/` after `npm run build`
2. Options → TypeSafe API key
3. Sensitivity: `chill` | `balanced` | `paranoid`
4. Custom keywords + allowlist (allowlist = opt-out only)
5. Popup → Open Autopilot for goal-driven runs
6. Optional: Options → Auto-connect → copy/download Claude/Cursor config → restart client (see AGENT-BRIDGE.md). No daily terminal.

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
- Bridge: enable in Options, run `askjev-mcp`, call `askjev_status` from an MCP client
