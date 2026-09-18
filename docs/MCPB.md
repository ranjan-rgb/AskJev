# AskJev MCPB (Claude Desktop Extension)

Ship AskJev’s MCP bridge as a **one-click Desktop Extension** for Claude Desktop.

## User path

1. Load the AskJev Chrome/Brave extension (`extension/` after `npm run build`).
2. Options → **Auto-connect** (token + arm bridge).
3. Download `askjev-<version>.mcpb` from the latest [GitHub Release](https://github.com/ranjan2829/AskJev/releases).
4. Claude Desktop → **Settings → Extensions → Advanced → Install Extension…**
5. Paste **pairing token**; leave port `17373` unless you changed it.
6. Restart Claude if tools do not appear. Popup should show bridge **Connected** / paired.

No daily `npx`. Cursor and power users can still use `npx -y askjev-mcp` — see [AGENT-BRIDGE.md](./AGENT-BRIDGE.md).

## Maintainer: pack

```bash
npm run pack:mcpb          # store/askjev-<version>.mcpb
npm run pack:chrome        # store/askjev-chrome-<version>.zip
npm run build:mcp && npm pack --prefix mcp --pack-destination store
```

Validate without packing:

```bash
cd mcpb && npx --yes @anthropic-ai/mcpb validate manifest.json
```

## Manifest notes

- `manifest_version`: `"0.3"` (MCPB schema compatible with current Claude Desktop).
- `server.type`: `node`, entry `server/index.js`.
- `user_config.askjev_token` (sensitive, required) → `ASKJEV_TOKEN`.
- `user_config.askjev_port` (number, default `17373`) → `ASKJEV_PORT`.
- Tools listed for store UI; `tools_generated: true` because the MCP SDK registers at runtime.

Claude Desktop may spawn the MCP process twice (Chat + Cowork/Code). askjev-mcp ≥ 1.5.5 attaches the second process as a peer — no config change required.

## Layout in git

```
mcpb/
  manifest.json     # source of truth for metadata
  package.json      # deps template (version synced at pack)
  icon.png
  .mcpbignore
  README.md
  server/           # pack-time only (gitignored contents)
```

Source of the server binary is always `mcp/` — never edit JS under `mcpb/server/` by hand.
