# MacBook sync — AskJev v1.5.7

Ranjan’s Brave + LaunchAgent setup after the offscreen-bridge fix.

## What changed

1. **Agent bridge WebSocket moves to a Chrome offscreen document** so MV3 service-worker idle no longer kills the socket mid-RPC (`list_tabs` / `status` / `act`).
2. **Guard quieter by default**: `requireConfirmOnAsk=false`, bare `confirm`/`accept`/`agree` no longer trap GitHub PR titles / cookie banners. Escape + Dismiss still work. Only truly irreversible acts freeze.
3. **`ASKJEV_BRIDGE_ONLY=1`**: LaunchAgent can own `127.0.0.1:17373` forever (WS only, no stdio). Claude attaches as peer (existing `BridgeAttach`).
4. **`askjev_status`**: if paired but status RPC fails, returns `paired:true` + `warning` — never looks fully offline.

## Update steps (Brave / Chrome)

1. Quit Brave fully (Cmd+Q).
2. Pull / download **v1.5.7** chrome zip from the GitHub release → unzip.
3. `brave://extensions` → AskJev → **Reload** (or Remove + Load unpacked pointing at the new `extension/` folder).
4. Open AskJev **Options** → confirm Agent Bridge still armed (token unchanged if you kept storage).
5. Optional: leave **Overlay on ask** unchecked (new default for fresh installs; existing sync may still have it on — uncheck + Save).

## LaunchAgent (bridge-only owner)

Keep your existing LaunchAgent that runs askjev-mcp on port **17373**, but set:

```xml
<key>EnvironmentVariables</key>
<dict>
  <key>ASKJEV_TOKEN</key>
  <string>YOUR_PAIRING_TOKEN</string>
  <key>ASKJEV_PORT</key>
  <string>17373</string>
  <key>ASKJEV_BRIDGE_ONLY</key>
  <string>1</string>
</dict>
```

Or in a shell plist ProgramArguments env:

```bash
export ASKJEV_BRIDGE_ONLY=1
export ASKJEV_TOKEN=…
export ASKJEV_PORT=17373
npx -y askjev-mcp@1.5.7
# or: node /path/to/askjev-mcp/bin/askjev-mcp.js
```

Claude Desktop / Cursor configs stay as peers (stdio + same token/port) — they attach when the port is already bound.

Reload LaunchAgent:

```bash
launchctl unload ~/Library/LaunchAgents/com.askjev.bridge.plist
launchctl load ~/Library/LaunchAgents/com.askjev.bridge.plist
```

## Manual verify (bridge survives RPC)

1. LaunchAgent up → Brave AskJev popup shows **Connected** / paired.
2. From Claude (or a tiny node script against the bridge): call `askjev_status`, then `askjev_list_tabs`, then `askjev_status` again.
3. **Success**: all three return without `extension disconnected` / `not_paired`. Options bridge pill stays `paired`.
4. If it still drops: check `brave://extensions` → AskJev → service worker “Inspect” — you should see an **OffscreenDocument** context; WS must live there, not only in the SW.

## Artifacts on this machine

Built zip lands at:

- `/workspace/AskJev/store/askjev-chrome-1.5.7.zip`
- `/workspace/AskJev/store/askjev-mcp-1.5.7.tgz`
- `/workspace/AskJev/store/askjev-1.5.7.mcpb`

Copy the chrome zip to the MacBook (AirDrop / `scp`) and reload the extension as above.
