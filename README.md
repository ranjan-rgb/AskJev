# Veto

Chrome extension: **TypeSafe Jev** vetoes irreversible clicks before they fire.

Not a browser agent. The page stays under human (or agent) control. Veto only decides **proceed / block / ask** on pay, buy, delete, send, approve, deploy.

## Why

Feed is full of “Jev drives Flights.” The missing product is a **decision gate on dangerous actions**.

## Load unpacked

1. Open `chrome://extensions` → Developer mode → Load unpacked → select `extension/`
2. Click the Veto icon → paste `TYPESAFE_API_KEY`
3. Open `demo/index.html` (or `npm run demo` → http://127.0.0.1:8765)
4. Click **Pay now with card** — overlay shows irreversible / risk / choice

## Jev questions (one call)

- **Noul** `irreversible` — money / delete / send / prod?
- **Score** `risk` — 4-level danger rubric
- **Choice** `action` — `proceed` | `block` | `ask`

## Status

MVP scaffold. Needs live key smoke + GIF for X.
