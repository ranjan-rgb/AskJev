# askjev-mcp

MCP stdio server for [AskJev](https://github.com/ranjan2829/AskJev). Drives Brave/Chrome over CDP; a legacy localhost WebSocket bridge to the extension is still available behind `ASKJEV_MODE=bridge`.

**Production launch path:** Claude Desktop / Cursor run `npx -y askjev-mcp` via their MCP config `command` field. You do not run `npx` yourself for daily use.

There is **no pasteable URL**. Claude starts this process over stdio.

See [docs/AGENT-BRIDGE.md](../docs/AGENT-BRIDGE.md) for one-click Auto-connect.

## CDP Autopilot (default)

`askjev_do` / `askjev_start_goal` run a **TypeSafe Jev Autopilot** loop over Playwright/CDP
(System One decisions — not a Claude planner). Per step: snapshot → one fan-out
`POST https://api.typesafe.ai/v1/systemone` (Noul/Choice/Score) → act.

AskJev first tries to attach to an already-running debug browser at `ASKJEV_CDP_URL`; if that
fails it launches a system browser itself. **Brave is preferred on every platform** (macOS,
Windows, Linux), then Chrome, then Chromium, then Edge. On Windows both machine-wide
(`%PROGRAMFILES%`, `%PROGRAMFILES(X86)%`) and per-user (`%LOCALAPPDATA%`) installs are detected.

Guard: Autopilot stops when Jev's `irreversible` noul is **≥ 0.65** (pay / delete / send /
publish / deploy-class steps). It does not auto-confirm. This gate lives in the Autopilot loop
only — the single-action tools (`askjev_act`, `askjev_click`, `askjev_navigate`, `askjev_type`)
execute what they are told. When askjev-mcp launches the browser itself it uses a clean
Playwright profile with no extension loaded, so the extension's in-page click overlay is not
present in that window.

TypeSafe HTTP handling: `429` and `529` are retried with exponential backoff (honouring
`Retry-After`, 2 retries by default); `401` and `422` fail fast with `unauthorized` /
`invalid_params`.

The loop also stops itself rather than burning the step budget (and your TypeSafe quota):

- **Low confidence** — when Jev's confidence in a CLICK / TYPE_TEXT / SELECT falls below
  `ASKJEV_MIN_CONFIDENCE` (default `0.45`), AskJev scrolls for more context instead of
  clicking blind. After two such probes it stops and says so. Scrolls and waits are never
  gated — they are the fallback.
- **Stuck** — the same action on the same target three times, SCROLL_DOWN/SCROLL_UP
  oscillation, or an unchanged page (URL, title, element list) across four steps all end the
  run with an actionable note instead of looping to `ASKJEV_MAX_STEPS`.

### API key

Required for multi-step goals, resolved in order:
`ASKJEV_API_KEY` → `TYPESAFE_API_KEY` → `~/.askjev/api-key`.

Extension Options → Auto-connect writes both env vars into Claude's config **and**
`~/.askjev/api-key` (mode `600`) when a key is saved.

Without a key, `askjev_do` / `askjev_start_goal` fail loudly with the `missing_api_key` error
code instead of silently navigating and scrolling. Single-step tools (`askjev_navigate`,
`askjev_click`, `askjev_type`, `askjev_act`, `askjev_read_page`, `askjev_screenshot`, …) do not
need a key — they never call Jev.

## Tools

| Tool | Purpose |
|------|---------|
| `askjev_do` | **Primary.** Run the user's natural-language goal end to end (Jev Autopilot) |
| `askjev_start_goal` | Alias of `askjev_do` — same behavior |
| `askjev_stop` | Stop a running Autopilot loop |
| `askjev_status` | CDP / bridge / Autopilot status, plus `hasApiKey` |
| `askjev_list_tabs` | List open tabs |
| `askjev_navigate` | Open a URL |
| `askjev_snapshot` | Interactive element snapshot (ids for `askjev_act`) |
| `askjev_act` | One DOM action: `CLICK`, `TYPE_TEXT`, `SELECT`, `SCROLL_DOWN`, `SCROLL_UP`, `WAIT`, `PRESS` |
| `askjev_click` | Click by visible label text |
| `askjev_type` | Type into the focused field |
| `askjev_back` / `askjev_forward` | History navigation |
| `askjev_read_page` | URL, title, visible text |
| `askjev_screenshot` | PNG of the current viewport |

Error codes: `not_paired`, `bridge_offline`, `guard_blocked`, `missing_api_key`,
`rate_limited`, `unauthorized`, `timeout`, `invalid_params`, `internal`.

## Environment

| Var | Default | Read by |
|-----|---------|---------|
| `ASKJEV_MODE` | `cdp` | `cdp` \| `bridge` \| `auto`. Auto-connect always writes `cdp` |
| `ASKJEV_CDP_URL` | `http://127.0.0.1:9222` | Existing debug browser to attach to before launching one |
| `ASKJEV_BROWSER_BIN` | auto-detected (Brave first) | Explicit browser binary path |
| `ASKJEV_MAX_STEPS` | `25` (capped at 100) | Autopilot step cap |
| `ASKJEV_MIN_CONFIDENCE` | `0.45` | Confidence floor for page-changing actions; out-of-range values fall back to the default |
| `ASKJEV_API_KEY` / `TYPESAFE_API_KEY` | — | TypeSafe System One key |
| `ASKJEV_TOKEN` | — | Pairing token; required only in `bridge` mode (≥ 64 chars) |
| `ASKJEV_PORT` | `17373` | Legacy bridge port |
| `ASKJEV_BRIDGE_ONLY` | unset | `1` = run as WebSocket bridge owner with no stdio server |

## Advanced — legacy WebSocket bridge

In `cdp` mode (the default, and what Auto-connect writes) this process **never** binds a
WebSocket port. The bridge opens only when `ASKJEV_MODE=bridge`, or `ASKJEV_MODE=auto` with an
`ASKJEV_TOKEN` of at least 64 characters.

```bash
# Power-user / debug only — prefer Auto-connect in the extension
ASKJEV_MODE=bridge ASKJEV_TOKEN=<pairing-token> npx -y askjev-mcp
```

It then listens on `ws://127.0.0.1:17373` (override with `ASKJEV_PORT`) for the AskJev
extension — localhost only, never a URL you paste anywhere. Over that bridge, and only there,
`act` is rate-limited to 30/min; the CDP `askjev_act` tool is not rate-limited.
