# AskJev agent notes

Use this when helping Ranjan configure or extend AskJev.

## Product

AskJev is a Chrome/Brave MV3 extension (TypeScript → `extension/`).

Two modes:

1. **Autopilot** — side panel goal → DOM snapshot → TypeSafe Jev Choice for next action → execute → loop. Stops on DONE/BLOCKED, max steps, or irreversible ≥ 0.65.
2. **Guard** — intercepts risky clicks; one System One call returns `irreversible` (noul), `risk` (score), `action` (choice: proceed|block|ask).

**AI connection:** only `POST https://api.typesafe.ai/v1/systemone` with the user’s TypeSafe API key. **Not Claude**, not OpenAI chat, no AskJev backend.

## Configure for the user

1. Load unpacked → `extension/` after `npm run build`
2. Options → TypeSafe API key
3. Sensitivity: `chill` | `balanced` | `paranoid`
4. Custom keywords + allowlist (allowlist = opt-out only)
5. Popup → Open Autopilot for goal-driven runs

## Extend safely

- Keep Jev questions atomic (TypeSafe guidance)
- Never log or commit API keys
- Prefer allowlist over weakening global keywords
- Autopilot must keep using the irreversible noul gate — do not bypass Guard for pay/delete/send-class steps
- Agents automating the browser should call the same decide / next-step paths, not raw clicks around them

## Demo

- Guard: `npm run demo` → Pay / Delete / Send on localhost
- Autopilot: side panel goal on any site (start low-risk)
