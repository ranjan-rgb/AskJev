#!/usr/bin/env bash
# Launch Brave with Chrome DevTools so askjev-mcp can drive it.
# Users still talk to Claude in plain language — this is only the browser side.
set -euo pipefail
PORT="${ASKJEV_CDP_PORT:-9222}"
PROFILE="${ASKJEV_BRAVE_PROFILE:-$HOME/.askjev/brave-cdp-profile}"
BRAVE="${ASKJEV_BRAVE_BIN:-/Applications/Brave Browser.app/Contents/MacOS/Brave Browser}"
EXT="${ASKJEV_EXTENSION:-$HOME/Desktop/AskJev-extension}"
mkdir -p "$PROFILE"
ARGS=(--remote-debugging-port="$PORT" --remote-allow-origins=* --user-data-dir="$PROFILE" --no-first-run --no-default-browser-check)
if [[ -d "$EXT" ]]; then
  ARGS+=(--disable-extensions-except="$EXT" --load-extension="$EXT")
fi
echo "AskJev: starting Brave CDP on port $PORT (profile $PROFILE)"
exec "$BRAVE" "${ARGS[@]}" "$@"
