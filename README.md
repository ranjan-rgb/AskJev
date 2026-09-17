# AskJev

**Jev autopilot for any website — with a guard on irreversible clicks.**

Production Chrome/Brave extension (TypeScript). Two modes:

1. **Autopilot** (side panel) — type a goal; Jev picks CLICK / TYPE_TEXT / SCROLL / DONE from the live DOM and AskJev executes it. Works on every site.
2. **Guard** — still freezes high-impact clicks (delete, pay, send, publish, …) and asks Jev proceed/block/ask. Autopilot **stops** if the next step looks irreversible (≥0.65).

Not a toy Flights demo. Built to be usable worldwide: cheap System One decisions, typed actions, human override.

## Setup

```bash
npm install && npm run build
```

Load unpacked → `extension/` (Chrome or Brave). Options → TypeSafe API key. Popup → **Open Autopilot**.

## How AI connects

`POST https://api.typesafe.ai/v1/systemone` with your key. No AskJev backend.

## License

MIT
