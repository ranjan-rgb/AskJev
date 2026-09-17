# AskJev Agent Bridge

Connect **any MCP client** (Claude Desktop, Cursor, Windsurf, …) to the AskJev browser extension so an agent can drive the active tab — with the same Guard that Autopilot uses.

## Architecture

```
Claude / Cursor  --stdio MCP-->  askjev-mcp (Node)
                                      |
                                      | WebSocket server
                                      | ws://127.0.0.1:17373
                                      v
                              AskJev extension (client)
                                      |
                                      +--> Autopilot loop / DOM snapshot+act
                                      +--> Guard (irreversible ≥ 0.65)
```

- **MCP process is the WebSocket server** (localhost only).
- **Extension is the client** — enables when you turn on Agent Bridge and dials in with the pairing token.
- TypeSafe API key **never** crosses the bridge; only the extension calls `api.typesafe.ai`.

## 3-step connect (all users)

### 1. Extension

1. Load AskJev (`npm run build` → Load unpacked → `extension/`).
2. Options → **Agent bridge** → **Generate token** → **Copy**.
3. Check **Enable agent bridge** → **Save**.

### 2. Run the MCP bridge

```bash
export ASKJEV_TOKEN='<paste pairing token>'
npx askjev-mcp
# or from this repo: npm run build -w askjev-mcp && ASKJEV_TOKEN=... node mcp/bin/askjev-mcp.js
```

Optional: `ASKJEV_PORT=17373` (must match Options → Bridge port).

Wait until the Options status shows `paired`.

### 3. Point your MCP client at askjev-mcp

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "askjev": {
      "command": "npx",
      "args": ["-y", "askjev-mcp"],
      "env": {
        "ASKJEV_TOKEN": "PASTE_TOKEN_HERE"
      }
    }
  }
}
```

**Cursor** (`.cursor/mcp.json` or Settings → MCP):

```json
{
  "mcpServers": {
    "askjev": {
      "command": "npx",
      "args": ["-y", "askjev-mcp"],
      "env": {
        "ASKJEV_TOKEN": "PASTE_TOKEN_HERE"
      }
    }
  }
}
```

Restart the client after saving. Tools appear as `askjev_*`.

## MCP tools

| Tool | Mode | Purpose |
|------|------|---------|
| `askjev_start_goal` | A | Start Autopilot with a natural-language goal |
| `askjev_stop` | A | Stop Autopilot |
| `askjev_status` | A | Bridge + Autopilot status |
| `askjev_snapshot` | B | Interactive element snapshot (ids) |
| `askjev_act` | B | One DOM action (rate-limited 30/min) |
| `askjev_list_tabs` | B | List open tabs |

Structured error codes: `not_paired`, `bridge_offline`, `guard_blocked`, `missing_api_key`, `rate_limited`, `unauthorized`.

## Wire protocol (extension ↔ bridge)

JSON text frames over WebSocket.

```json
{ "type": "hello", "token": "<hex>", "role": "extension", "version": "1.0" }
{ "type": "hello", "token": "<hex>", "role": "mcp", "version": "1.0" }
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
| Revoke | Options → Revoke clears token and disables bridge |

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

## Dev from this repo

```bash
npm install
npm run build          # extension + mcp
npm run typecheck
ASKJEV_TOKEN=… node mcp/bin/askjev-mcp.js
```
