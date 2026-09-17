# AskJev

**Ask TypeSafe Jev before dangerous clicks — on every website.**

Chrome MV3 + TypeScript. Not a browser agent. Runs on **`<all_urls>`**. Jev decides **proceed / block / ask**.

This is not a pay-button toy. AskJev watches high-impact actions across the web: delete, send, publish, deploy, revoke, confirm, authorize, form submits, destructive UI — plus payments. You allowlist only the hosts you trust.

## How AI connects

1. TypeSafe API key in Options  
2. Risky click frozen on any site  
3. `POST https://api.typesafe.ai/v1/systemone` (noul + score + choice)  
4. Overlay → proceed / block / ask  

No AskJev backend.

## Modes

- **Chill / Balanced** — broad keyword + destructive UI + generic form confirms  
- **Paranoid** or **Gate all form submits** — also intercepts form submits (noisier)

## Develop (on this machine)

```bash
npm install && npm run build && npm run typecheck
```

Load unpacked → `extension/`

## License

MIT
