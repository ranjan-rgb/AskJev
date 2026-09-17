# askjev-mcp

MCP stdio server + localhost WebSocket bridge for [AskJev](https://github.com/ranjan2829/AskJev).

Connect Claude Desktop, Cursor, or any MCP client to the AskJev Chrome/Brave extension. The MCP process listens on `127.0.0.1` only; the extension dials in with a pairing token.

See [docs/AGENT-BRIDGE.md](../docs/AGENT-BRIDGE.md) for the full protocol and 3-step connect guide.

```bash
ASKJEV_TOKEN=<pairing-token> npx askjev-mcp
```

Default bridge port: `17373` (override with `ASKJEV_PORT`).
