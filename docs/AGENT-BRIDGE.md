# AskJev Agent Bridge

Connect **Claude Desktop** or **Cursor** to AskJev so an agent can drive the browser — with the same Guard that Autopilot uses.

Two transports exist. The **product path** is `askjev-mcp` driving Brave/Chrome directly over CDP (`ASKJEV_MODE=cdp`, the default, and what Auto-connect writes). The **legacy path** is the localhost WebSocket bridge to the Chrome extension; it is opt-in and described under Advanced.

**You never open a terminal for daily use.** Claude (or Cursor) starts `askjev-mcp` for you.

## The one thing to remember

| Myth | Reality |
|------|---------|
| “I need a URL to paste into Claude” | **No.** Claude Desktop has no AskJev URL. It launches `npx -y askjev-mcp` over **stdio** from its config file. |
| “I must run `npx` myself every day” | **No.** That is Claude’s job via the config `command` field. |
| “What is `ws://127.0.0.1:17373`?” | The **legacy** bridge between `askjev-mcp` and the Chrome extension. Localhost only, never pasted anywhere — and in the default `ASKJEV_MODE=cdp` path it is never opened at all. |

> A future HTTP/SSE transport (if added) would still be **127.0.0.1 only**. Today’s production path is stdio MCP + a locally launched CDP browser; the localhost WebSocket is the legacy fallback.

## Happy path — Auto-connect (preferred)

**No daily terminal. No paste-JSON. No CDP flags for end users.**

1. Load the AskJev Brave/Chrome extension (`extension/`).
2. **Options** → paste **TypeSafe API key** → **Auto-connect**.
   - Arms the bridge + token
   - **Downloads** `AskJev-Connect-Claude.command` / `.bat` / `.sh` for your OS
   - Also copies MCP JSON to the clipboard as a backup
3. **Double-click the Connect script once** — writes Claude `mcpServers.askjev` with the CDP env (`ASKJEV_MODE=cdp`, `ASKJEV_BROWSER_BIN` = Brave, `ASKJEV_TOKEN`/`ASKJEV_PORT`, `ASKJEV_API_KEY` + `TYPESAFE_API_KEY`) and, only if a key was saved, `~/.askjev/api-key` (mode `600`). Needs Python 3 on Windows; macOS and Linux ship it.
4. **Quit & reopen Claude** → chat: `open example.com and click More information`

Claude launches `npx -y askjev-mcp`. AskJev drives Brave/Chrome over CDP. TypeSafe Jev decides on-page.

Browser pick: Brave first on **every** platform (macOS, Windows, Linux), then Chrome, Chromium, Edge. On Windows both machine-wide and per-user (`%LOCALAPPDATA%`) installs are found. Override with `ASKJEV_BROWSER_BIN`.

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
Without one, multi-step goals fail loudly with `missing_api_key`; single-step tools still work.

Auto-connect does **not** write `ASKJEV_CDP_URL`. Set it yourself only if you keep a debug
browser on a non-default endpoint (default `http://127.0.0.1:9222`); askjev-mcp attaches to it
if reachable, otherwise it launches a browser itself.

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
                                      | ws://127.0.0.1:17373 (bridge mode only)
                                      v
                              AskJev extension (Guard / side panel)
```

- **Product path:** CDP Autopilot — Claude talks, askjev-mcp drives the browser, Jev decides. One fan-out `POST https://api.typesafe.ai/v1/systemone` per step; `429`/`529` retried with backoff (honours `Retry-After`), `401`/`422` fail fast.
- **Extension:** Guard + Options Auto-connect + optional side-panel Autopilot.
- **WebSocket** (when used) lives in an MV3 offscreen document so RPCs survive SW idle.

### LaunchAgent bridge-only (Mac)

If Claude Desktop double-spawns and you want a stable owner on `17373`:

```bash
ASKJEV_BRIDGE_ONLY=1 ASKJEV_TOKEN=… ASKJEV_PORT=17373 npx -y askjev-mcp
```

Claude/Cursor keep their normal stdio config and **attach as peers**. `docs/MACBOOK-SYNC-v1.5.7.md` is a historical v1.5.7 note, not current setup.

- The TypeSafe API key **never** crosses the WebSocket bridge. Two processes call `api.typesafe.ai` directly with their own copy of the key: the extension (Guard, side-panel Autopilot) from `storage.sync`, and `askjev-mcp` (CDP Autopilot) from `ASKJEV_API_KEY` / `TYPESAFE_API_KEY` / `~/.askjev/api-key`.

## Claude Desktop double-spawn (bridge mode only)

In the default `cdp` mode no process binds a port, so double-spawn is harmless and this section does not apply.

In bridge mode, Claude Desktop can start **two** stdio MCP processes for the same server (Chat + Cowork/Code). Both try to bind `127.0.0.1:17373`.

- **First process** owns the WebSocket bridge (`BridgeServer.listen`).
- **Second process** sees `EADDRINUSE`, logs an attach message, and connects as a **controller** peer (`BridgeAttach`) — same MCP tools, no second bind, no crash.

This matches the Kapture-style pattern: one WS bridge owner; extra MCP processes attach as peers. You do not need to change Claude config; askjev-mcp ≥ 1.5.5 handles it automatically.

Roles on the wire: `extension` (one Chrome client), `controller` (many peer MCP processes), `mcp` (hello reply from the owner).


## MCP tools

All 14 tools registered by `mcp/src/index.ts`:

| Tool | Purpose |
|------|---------|
| `askjev_do` | **Primary.** Run the user's natural-language goal end to end (Jev Autopilot) |
| `askjev_start_goal` | Alias of `askjev_do` — identical behavior |
| `askjev_stop` | Stop the running Autopilot loop |
| `askjev_status` | CDP / bridge / Autopilot status, plus `hasApiKey` |
| `askjev_list_tabs` | List open tabs |
| `askjev_navigate` | Open a URL |
| `askjev_snapshot` | Interactive element snapshot (ids for `askjev_act`, capped at 80 elements) |
| `askjev_act` | One DOM action: `CLICK`, `TYPE_TEXT`, `SELECT`, `SCROLL_DOWN`, `SCROLL_UP`, `WAIT`, `PRESS` |
| `askjev_click` | Click by visible label text |
| `askjev_type` | Type into the focused field |
| `askjev_back` | Browser back |
| `askjev_forward` | Browser forward |
| `askjev_read_page` | URL, title, visible text |
| `askjev_screenshot` | PNG of the current viewport |

Structured error codes: `not_paired`, `bridge_offline`, `guard_blocked`, `missing_api_key`, `rate_limited`, `unauthorized`, `timeout`, `invalid_params`, `internal`. Tool errors may include a `hint` with fix steps. `askjev_status` reports `mode` (`server` vs `attach`) and a `modeNote`.

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
| API key | Never sent over WS. Extension copy lives in Chrome `storage.sync`; MCP copy in Claude env / `~/.askjev/api-key` (mode `600`) |
| Guard | Autopilot stops at irreversible ≥ 0.65 — both the MCP CDP loop (`mcp/src/jev-autopilot.ts`) and the extension side panel. Bridge-mode `act` is Guard-checked in the extension at the same threshold. The direct CDP tools (`askjev_act`, `askjev_click`, `askjev_navigate`, `askjev_type`) are **not** gated |
| Rate limit | Bridge RPC `act` limited to 30/min by `BridgeServer`. The CDP `askjev_act` tool is not rate-limited |
| Revoke | Options → Advanced → Revoke clears token and disables bridge |

**Threats considered**

- *Malicious local process:* needs the pairing token; revoke rotates it.
- *Remote attacker:* no listening port outside loopback.
- *Prompt-injected agent:* the Autopilot loop still stops on pay/delete/send-class steps at 0.65. But a caller that drives `askjev_act` / `askjev_click` / `askjev_navigate` directly has **no** gate in the default path — see the coverage limit below.
- *Stolen sync storage:* treat like any extension secret — revoke token + rotate TypeSafe key.

**Not a sandbox.** The agent can operate the browser as you. Only enable the bridge when you intend to automate; revoke when done.

**Coverage limit.** Two gaps worth knowing:

1. `ensureBrowser()` in `mcp/src/cdp-browser.ts` launches the browser with a fresh Playwright profile and **no `--load-extension`** — the AskJev extension, and therefore the in-page click Guard, is not present in the window askjev-mcp drives. In that window the only gate is the Autopilot loop's `irreversible ≥ 0.65` check. The in-page Guard protects *your own* browser, and the debug browser started by `scripts/run-brave-cdp.sh` (which does load the extension).
2. The Guard content script is injected at `<all_urls>` with `all_frames: false` — clicks inside cross-origin iframes are not intercepted.

## Defaults

Extension (`chrome.storage.sync`):

| Setting | Default |
|---------|---------|
| `bridgeEnabled` | `false` |
| `bridgeToken` | `""` |
| `bridgePort` | `17373` |
| `sensitivity` | `balanced` |
| `requireConfirmOnAsk` | `false` |
| `gateFormSubmits` | `false` |

`askjev-mcp` environment:

| Var | Default |
|-----|---------|
| `ASKJEV_MODE` | `cdp` (an unrecognised value falls back to `auto`) |
| `ASKJEV_CDP_URL` | `http://127.0.0.1:9222` |
| `ASKJEV_PORT` | `17373` |
| `ASKJEV_MAX_STEPS` | `25` (hard cap `100`) |
| `ASKJEV_BROWSER_BIN` | auto-detected, Brave first on all platforms |
| `ASKJEV_API_KEY` / `TYPESAFE_API_KEY` | unset — falls back to `~/.askjev/api-key` |
| `ASKJEV_BRIDGE_ONLY` | unset |

---

## Appendix: power-user terminal (optional)

Daily use does **not** need this. Prefer Auto-connect.

```bash
# Only for debugging askjev-mcp outside Claude/Cursor
npx -y askjev-mcp                    # default ASKJEV_MODE=cdp — no WebSocket is opened

# Legacy bridge mode needs BOTH the mode and a ≥64-char pairing token:
ASKJEV_MODE=bridge ASKJEV_TOKEN='<pairing token from Options → Advanced>' npx -y askjev-mcp
# or from this repo:
ASKJEV_MODE=bridge ASKJEV_TOKEN=… node mcp/bin/askjev-mcp.js
```

Optional: `ASKJEV_PORT=17373` (must match Options → Bridge port), `ASKJEV_CDP_URL` (default `http://127.0.0.1:9222`), `ASKJEV_MAX_STEPS` (default `25`, capped at `100`), `ASKJEV_BROWSER_BIN`.

`scripts/run-brave-cdp.sh` in this repo launches Brave with `--remote-debugging-port` for that attach path. It is a maintainer/debug convenience — **end users never run it**, because askjev-mcp launches the browser itself.

### Dev from this repo

```bash
npm install
npm run build          # extension + mcp
npm run typecheck
npm test               # extension + logic + mcp suites
node mcp/bin/askjev-mcp.js
```

## Desktop Extension packing

Maintainer notes: [MCPB.md](./MCPB.md).
