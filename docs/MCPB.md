# AskJev MCPB (Claude Desktop Extension) — Advanced

Ship AskJev’s MCP server as a **Desktop Extension** for Claude Desktop.

> **Advanced / legacy path.** The supported end-user setup is Options → Auto-connect
> ([AGENT-BRIDGE.md](./AGENT-BRIDGE.md)). Use `.mcpb` only if the Connect-script download is
> blocked.
>
> Two caveats in the current bundle:
> - `mcpb/manifest.json` passes only `ASKJEV_TOKEN` and `ASKJEV_PORT`. It does **not** set
>   `ASKJEV_MODE=bridge`, so the server starts in the default `cdp` mode and never opens the
>   WebSocket bridge — the pairing token you paste is unused. It also sets no
>   `ASKJEV_API_KEY` / `TYPESAFE_API_KEY`, so multi-step goals only work if
>   `~/.askjev/api-key` already exists (write it by running Auto-connect once).
> - The `tools` array in the manifest lists 6 tools; the server registers 14. `tools_generated:
>   true` means Claude uses the runtime list, so this is a store-listing cosmetic issue only.

## User path

1. Load the AskJev Brave/Chrome extension (`extension/`).
2. Options → paste TypeSafe API key → **Auto-connect** (writes `~/.askjev/api-key`, arms token).
3. Download `askjev-<version>.mcpb` from the latest [GitHub Release](https://github.com/ranjan2829/AskJev/releases).
4. Claude Desktop → **Settings → Extensions → Advanced → Install Extension…**
5. Paste **pairing token**; leave port `17373` unless you changed it.
6. Restart Claude if tools do not appear.

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
- Tools listed for store UI only; `tools_generated: true` because the MCP SDK registers at runtime. The array is currently out of date — see the caveat above.

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
