# Security policy

Spoor records what people type in their browser, so privacy bugs are security bugs.

## What to report privately

- A sensitive field (password, card data, one time code, or a field the rules in [`extension/lib/sensitive.ts`](extension/lib/sensitive.ts) should catch) that ends up in IndexedDB, the SQLite file, an export or an MCP tool result.
- Anything recorded in an incognito window, on an excluded site, or while paused.
- Any network request made by the extension or the bridge.
- A way for a web page, another extension or another local program to read Spoor's data, send commands to the background worker, or talk to the native messaging host.
- An MCP tool that returns typed values, clipboard text or prompt text while "Let Claude read typed values" is off.
- Permissions on `~/.spoor` or `events.db` that let other users read them.

## How to report

Use GitHub's private vulnerability reporting: **Security** tab → **Report a vulnerability**. Please do not open a public issue, and do not attach real recorded data. Reproduce with the fixture app (`npm run fixture`) or the demo data (`npm run demo -w bridge`) instead.

Include the browser and version, the operating system, the Spoor version, and the steps or page markup that reproduce it.

You should get an answer within 7 days. Fixes are released as a new version, with a note in the GitHub release crediting you unless you prefer otherwise.

## Supported versions

Only the latest release gets fixes while Spoor is below 1.0.

## Known limits (not vulnerabilities)

These are documented in [docs/PRIVACY.md](docs/PRIVACY.md#known-limits):

- A password typed or pasted into a normal text field is recorded like any other text.
- The SQLite file is not encrypted at rest. Anyone who can read your user account's files can read it.
- When "Let Claude read typed values" is on, tool results that Claude requests become part of your Claude conversation.
