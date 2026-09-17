# AskJev

**Ask TypeSafe Jev before dangerous clicks — on every site.**

Chrome MV3 extension written in **TypeScript**. Not a browser agent. AskJev decides **proceed / block / ask** using [TypeSafe Jev](https://docs.typesafe.ai/introduction).

## How it connects to the AI

1. Paste your TypeSafe API key in Options.
2. Risky click (pay / delete / send / approve) is frozen on **every site**.
3. Background worker → `POST https://api.typesafe.ai/v1/systemone` with your key.
4. One call: irreversible (noul) + risk (score) + action (choice).
5. Overlay → proceed / block / ask.

No AskJev server.

## Develop

```bash
npm install
npm run build
npm run typecheck
```

Load unpacked → `extension/`

## All sites

`content_scripts.matches = ["<all_urls>"]`. Allowlist is the only opt-out.

## License

MIT
