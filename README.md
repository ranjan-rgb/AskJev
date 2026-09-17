# AskJev

**Jev autopilot for any website — plus a guard on irreversible clicks.**

Production Chrome / Brave MV3 extension (TypeScript). Type a goal and Jev drives the page. High-impact clicks still get frozen and judged before they land.

Built for worldwide use: every site by default (`<all_urls>`), cheap System One decisions, typed DOM actions, human override. Not a Flights toy demo.

## What it is

| Mode | Where | What happens |
|------|--------|--------------|
| **Autopilot** | Side panel | You type a goal. AskJev snapshots interactive elements, asks Jev for the next action (`CLICK` / `TYPE_TEXT` / `SELECT` / `SCROLL_*` / `WAIT` / `DONE` / `BLOCKED`), executes it, repeats (max 20 steps). |
| **Guard** | Every page | Risky clicks (pay, delete, send, publish, deploy, …) are held. Jev scores irreversible + risk and chooses `proceed` / `block` / `ask`. Overlay lets you confirm. Autopilot **stops** if the next step looks irreversible (≥ 0.65). |

Allowlist is the only opt-out. There is no AskJev backend.

## How AI connects (not Claude)

AskJev does **not** use Claude, ChatGPT, or any chat LLM.

It calls **TypeSafe Jev** (System One) only:

```http
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <your TypeSafe API key>
```

Jev returns structured decisions (Choice / Score / Noul) — no free-form text generation. Your API key lives in Chrome sync storage and is sent only to `api.typesafe.ai`.

Docs: [docs.typesafe.ai](https://docs.typesafe.ai/introduction)

## Setup

```bash
npm install && npm run build
```

1. Chrome or Brave → Extensions → **Load unpacked** → select `extension/`
2. Options → paste your **TypeSafe** API key
3. Popup → **Open Autopilot** (or open the side panel)
4. Optional Guard demo: `npm run demo` → open `http://localhost:8765` → click Pay / Delete / Send

## Project layout

```
src/                 TypeScript source
  background.ts      Guard decide + Autopilot loop
  content.ts         Click gate + DOM snapshot/execute
  autopilot-jev.ts   Jev next-step Choice
  dom.ts             Interactive element snapshot + actions
  sidepanel.ts       Autopilot UI
  jev.ts             System One client (Guard)
extension/           Built MV3 package (load this)
demo/                Local checkout page for Guard
store/LISTING.md     Chrome Web Store copy draft
docs/AGENT.md        Notes for agents extending AskJev
```

## Build / ship

```bash
npm run typecheck
npm run build          # → extension/
npm run pack           # zip for store (see store/)
```

Current version: **1.3.0**

## Privacy

- API key: Chrome `storage.sync` only
- Network: only `https://api.typesafe.ai/*` (plus the pages you browse)
- No AskJev servers, no analytics backend

## License

MIT
