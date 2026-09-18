# AskJev Agent Bridge

Connect **Claude Desktop** or **Cursor** to the AskJev browser extension so an agent can drive the active tab — with the same Guard that Autopilot uses.

**You never open a terminal for daily use.** Claude (or Cursor) starts the bridge for you.

## The one thing to remember

| Myth | Reality |
|------|---------|
| “I need a URL to paste into Claude” | **No.** Claude Desktop has no AskJev URL. It launches `npx -y askjev-mcp` over **stdio** from its config file. |
| “I must run `npx` myself every day” | **No.** That is Claude’s job via the config `command` field. |
| “What is `ws://127.0.0.1:17373`?” | Internal only — between `askjev-mcp` and the Chrome extension. Automatic. Localhost only. Not something you paste anywhere. |

> A future HTTP/SSE transport (if added) would still be **127.0.0.1 only**. Today’s production path is stdio + localhost WebSocket.

## Happy path — Auto-connect (preferred)

**No daily terminal. No paste-JSON. No CDP flags for end users.**

1. Load the AskJev Chrome/Brave extension (`extension/`).
2. **Options** → paste **TypeSafe API key** → **Auto-connect**.
   - Arms the bridge + token
   - **Downloads** `AskJev-Connect-Claude.command` / `.bat` / `.sh` for your OS
   - Also copies MCP JSON to the clipboard as a backup
3. **Double-click the Connect script once** — writes Claude `mcpServers.askjev` with full CDP env (`ASKJEV_MODE=cdp`, Brave bin, token/port, API key) and `~/.askjev/api-key` (mode `600`).
4. **Quit & reopen Claude** → chat: `open example.com and click More information`

Claude launches `npx -y askjev-mcp`. AskJev drives Brave/Chrome over CDP. TypeSafe Jev decides on-page.

---

## Advanced — paste JSON / `.mcpb` / Cursor

Use only if Auto-connect download is blocked.

### More ways (Options → “More ways to connect”)

- **Claude / Cursor config** — copy JSON and paste into:
  - Claude: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS), `%APPDATA%\Claude\claude_desktop_config.json` (Windows), `~/.config/Claude/claude_desktop_config.json` (Linux)
  - Cursor: `.cursor/mcp.json` or Settings → MCP
- **Manual platform scripts** — same Connect script as Auto-connect, downloaded on demand

Example env (Auto-connect fills these; do not paste secrets into git):

```json
{
  "mcpServers": {
    "askjev": {
      "command": "npx",
      "args": ["-y", "askjev-mcp"],
      "env": {
        "ASKJEV_TOKEN": "<filled-by-extension>",
        "ASKJEV_PORT": "17373",
        "ASKJEV_MODE": "cdp",
        "ASKJEV_BROWSER_BIN": "<Brave path>",
        "ASKJEV_API_KEY": "<TypeSafe key>",
        "TYPESAFE_API_KEY": "<TypeSafe key>"
      }
    }
  }
}
```

API key resolution in MCP: `ASKJEV_API_KEY` → `TYPESAFE_API_KEY` → `~/.askjev/api-key`.

### Legacy `.mcpb`

Claude Desktop Extension install still works for pairing-token setups — see [docs/MCPB.md](MCPB.md). Prefer Auto-connect for CDP Autopilot.

**No daily terminal. No exporting `ASKJEV_TOKEN` in a shell.**

---

## Architecture

```
You → Claude (MCP client) → askjev-mcp (CDP Autopilot) → Brave/Chrome
                                      ↓
                           TypeSafe Jev System One
```

Optional legacy bridge (extension Guard + WS):

```
Claude / Cursor  --stdio MCP-->  askjev-mcp
                                      |
                                      | ws://127.0.0.1:17373 (automatic)
                                      v
                              AskJev extension (Guard / side panel)
```

- **Product path:** CDP Autopilot — Claude talks, askjev-mcp drives the browser, Jev decides.
- **Extension:** Guard + Options Auto-connect + optional side-panel Autopilot.
- **WebSocket** (when used) lives in an MV3 offscreen document so RPCs survive SW idle.

### LaunchAgent bridge-only (Mac)

If Claude Desktop double-spawns and you want a stable owner on `17373`:

```bash
ASKJEV_BRIDGE_ONLY=1 ASKJEV_TOKEN=… ASKJEV_PORT=17373 npx -y askjev-mcp
```

Claude/Cursor keep their normal stdio config and **attach as peers**. See `docs/MACBOOK-SYNC-v1.5.7.md`.
- TypeSafe API key **never** crosses the bridge; only the extension calls `api.typesafe.ai`.

## Claude Desktop double-spawn (expected)

Claude Desktop can start **two** stdio MCP processes for the same server (Chat + Cowork/Code). Both try to bind `127.0.0.1:17373`.

- **First process** owns the WebSocket bridge (`BridgeServer.listen`).
- **Second process** sees `EADDRINUSE`, logs an attach message, and connects as a **controller** peer (`BridgeAttach`) — same MCP tools, no second bind, no crash.

This matches the Kapture-style pattern: one WS bridge owner; extra MCP processes attach as peers. You do not need to change Claude config; askjev-mcp ≥ 1.5.5 handles it automatically.

Roles on the wire: `extension` (one Chrome client), `controller` (many peer MCP processes), `mcp` (hello reply from the owner).


## MCP tools

| Tool | Mode | Purpose |
|------|------|---------|
| `askjev_start_goal` | A | Start Autopilot with a natural-language goal |
| `askjev_stop` | A | Stop Autopilot |
| `askjev_status` | A | Bridge + Autopilot status |
| `askjev_snapshot` | B | Interactive element snapshot (ids) |
| `askjev_act` | B | One DOM action (rate-limited 30/min) |
| `askjev_list_tabs` | B | List open tabs |

Structured error codes: `not_paired`, `bridge_offline`, `guard_blocked`, `missing_api_key`, `rate_limited`, `unauthorized`, `timeout`. Tool errors may include a `hint` with fix steps. `askjev_status` reports `mode` (`listen`/`server` vs `attach`) and a `modeNote`.

## Wire protocol (extension ↔ bridge)

JSON text frames over WebSocket on `127.0.0.1` only.

```json
{ "type": "hello", "token": "<hex>", "role": "extension", "version": "1.0" }
{ "type": "hello", "token": "<hex>", "role": "mcp", "version": "1.0" }
{ "type": "hello", "token": "<hex>", "role": "controller", "version": "1.0" }
{ "type": "rpc", "id": "rpc_1", "token": "<hex>", "method": "start_goal", "params": { "goal": "…", "typeText": "…" } }
{ "type": "rpc_result", "id": "rpc_1", "ok": true, "result": { "started": true } }
{ "type": "rpc_result", "id": "rpc_1", "ok": false, "error": { "code": "guard_blocked", "message": "…" } }
{ "type": "ping", "token": "<hex>" }
{ "type": "pong" }
{ "type": "event", "event": "autopilot_log", "data": { "line": "…" } }
```

RPC methods: `start_goal`, `stop`, `status`, `snapshot`, `act`, `list_tabs`.

Every message that carries a `token` must match the pairing token (constant-time compare). Unauthorized sockets are closed.

## Security / threat model

| Control | Detail |
|---------|--------|
| Bind address | `127.0.0.1` only — not LAN/WAN |
| Pairing token | Crypto-random ≥32 bytes hex; required on hello + every RPC/ping |
| Compare | Constant-time (`timingSafeEqual` / XOR fold in extension) |
| API key | Stays in Chrome `storage.sync`; never sent over WS |
| Guard | Autopilot + `askjev_act` stop when irreversible ≥ 0.65 |
| Rate limit | `act` limited to 30/min in MCP |
| Revoke | Options → Advanced → Revoke clears token and disables bridge |

**Threats considered**

- *Malicious local process:* needs the pairing token; revoke rotates it.
- *Remote attacker:* no listening port outside loopback.
- *Prompt-injected agent:* Guard still blocks pay/delete/send-class acts; human overlay remains for click Guard.
- *Stolen sync storage:* treat like any extension secret — revoke token + rotate TypeSafe key.

**Not a sandbox.** The agent can operate the browser as you. Only enable the bridge when you intend to automate; revoke when done.

## Defaults

| Setting | Default |
|---------|---------|
| `bridgeEnabled` | `false` |
| `bridgeToken` | `""` |
| `bridgePort` | `17373` |

---

## Appendix: power-user terminal (optional)

Daily use does **not** need this. Prefer Auto-connect.

```bash
# Only for debugging askjev-mcp outside Claude/Cursor
export ASKJEV_TOKEN='<pairing token from Options → Advanced>'
npx -y askjev-mcp
# or from this repo:
ASKJEV_TOKEN=… node mcp/bin/askjev-mcp.js
```

Optional: `ASKJEV_PORT=17373` (must match Options → Bridge port).

### Dev from this repo

```bash
npm install
npm run build          # extension + mcp
npm run typecheck
ASKJEV_TOKEN=… node mcp/bin/askjev-mcp.js
```

## Desktop Extension packing

Maintainer notes: [MCPB.md](./MCPB.md).
