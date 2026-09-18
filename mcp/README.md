# askjev-mcp

MCP stdio server + localhost WebSocket bridge for [AskJev](https://github.com/ranjan2829/AskJev).

**Production launch path:** Claude Desktop / Cursor run `npx -y askjev-mcp` via their MCP config `command` field. You do not run `npx` yourself for daily use.

There is **no pasteable URL**. Claude starts this process over stdio; this process then listens on `ws://127.0.0.1:17373` for the AskJev extension (automatic, localhost only).

See [docs/AGENT-BRIDGE.md](../docs/AGENT-BRIDGE.md) for one-click Auto-connect.

```bash
# Power-user / debug only — prefer Auto-connect in the extension
ASKJEV_TOKEN=<pairing-token> npx -y askjev-mcp
```

Default bridge port: `17373` (override with `ASKJEV_PORT`).

## CDP Autopilot (v1.7+)

`askjev_do` / `askjev_start_goal` run a **TypeSafe Jev Autopilot** loop over Playwright/CDP
(System One decisions — not a Claude planner). AskJev will auto-launch Brave/Chrome when needed.

**Required for multi-step goals:** TypeSafe API key via (in order)
`ASKJEV_API_KEY` → `TYPESAFE_API_KEY` → `~/.askjev/api-key`.
Extension Options → Auto-connect writes Claude env **and** `~/.askjev/api-key` when a key is saved.
Without a key, multi-step goals fail loudly instead of silently scrolling.

CDP is the product path (`ASKJEV_MODE=cdp` always set by Auto-connect). Optional: `ASKJEV_MAX_STEPS` (default 25), `ASKJEV_BROWSER_BIN` (Brave preferred).

