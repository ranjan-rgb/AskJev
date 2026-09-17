# AskJev agent skill

Use this when helping Ranjan configure or extend AskJev.

## Product

AskJev is a Chrome MV3 extension. It intercepts risky clicks and asks TypeSafe Jev for three answers in one call: `irreversible` (noul), `risk` (score), `action` (choice: proceed|block|ask).

## Configure for the user

1. Open extension options (or tell them: extension icon → Options).
2. Ensure TypeSafe API key is set.
3. Set sensitivity: `chill` | `balanced` | `paranoid`.
4. Add custom keywords for their workflows (e.g. `refund`, `revoke`, `wire`).
5. Allowlist trusted hosts (bank they always use intentionally, localhost).

## Extend safely

- Keep questions atomic (TypeSafe guidance).
- Never log or commit API keys.
- Prefer allowlist over weakening global keywords.
- When adding agent automation: agents should call the same decide path, not bypass it.

## Demo for X

Load unpacked → demo checkout → Pay now → capture overlay with irreversible / risk / jev choice.
