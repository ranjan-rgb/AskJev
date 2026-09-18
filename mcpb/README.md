# AskJev Desktop Extension (MCPB)

One-click install for **Claude Desktop** — no daily terminal, no hand-edited JSON.

## What this package is

`askjev-*.mcpb` is an [MCPB / Desktop Extension](https://github.com/modelcontextprotocol/mcpb) bundle:

| Path | Role |
|------|------|
| `manifest.json` | MCPB identity, `user_config` (TypeSafe API key + optional browser/steps), launch `mcp_config` |
| `server/` | Built `askjev-mcp` JS (from `mcp/dist`) |
| `node_modules/` | Production deps (`@modelcontextprotocol/sdk`, `ws`, `zod`) |
| `icon.png` | Extension icon |

Claude Desktop runs `node ${__dirname}/server/index.js` with `ASKJEV_MODE=cdp` and the
TypeSafe API key from the install UI. No pairing token, no port: the default CDP
path drives the browser directly and never binds a WebSocket.

## Build / pack (maintainers)

From the **repo root** (not inside `mcpb/`):

```bash
npm run pack:mcpb
# → store/askjev-<version>.mcpb
```

`scripts/pack-mcpb.mjs`:

1. Builds `mcp/`
2. Stages `mcp/dist` → `mcpb/server/`
3. Syncs version + deps into `mcpb/manifest.json` and `mcpb/package.json`
4. `npm install --omit=dev` in `mcpb/`
5. `npx @anthropic-ai/mcpb validate` then `pack`

Do **not** commit `mcpb/node_modules/` or a filled `mcpb/server/` — they are pack-time artifacts.

## Install (users)

1. Double-click `askjev-<version>.mcpb`
2. Paste your TypeSafe API key in Claude's install dialog → **Install**

That is the whole setup. The browser extension is optional and only adds Guard
to your own browsing.
3. Pick `askjev-<version>.mcpb` from the [GitHub release](https://github.com/ranjan2829/AskJev/releases)
4. Paste the pairing token; confirm port `17373`
5. Keep the Chrome extension loaded with the bridge armed

See [docs/AGENT-BRIDGE.md](../docs/AGENT-BRIDGE.md) and [docs/MCPB.md](../docs/MCPB.md).
