# AskJev

**Jev holds fire on dangerous clicks — pay, delete, send, approve — before they land.**

Chrome extension. Not a browser agent. The page stays yours. AskJev only decides **proceed / block / ask** using [TypeSafe Jev](https://docs.typesafe.ai/introduction) (System One).

## Why

The feed is full of “Jev drives the browser.” AskJev is the opposite product: **a decision gate on irreversible actions**. One misclick on Pay / Delete / Deploy and you’re done. AskJev pauses the click, asks Jev once (Noul + Score + Choice), shows probabilities, then allows or blocks.

## Install (dev)

1. Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → select `extension/`
2. Options → paste your TypeSafe API key → Save
3. Open `demo/index.html` or run `npm run demo` → click **Pay now with card**

## Pack for Chrome Web Store

```bash
npm run pack
# → store/askjev-1.0.0.zip
```

## Privacy

API key stays in Chrome sync storage. Risky-click context (URL, title, snippet, button label) is sent only to `api.typesafe.ai`. No AskJev backend. See `extension/privacy.html`.

## Agent skill

See `docs/AGENT.md` — drop into Claude Code / Cursor so an agent can configure keywords, sensitivity, and allowlists for you.

## Stack

- MV3 service worker + content script
- TypeSafe `POST /v1/systemone` · model `jev-latest`
- Zinc UI, zero telemetry by default

## License

MIT
