# Contributing to Spoor

Thanks for helping. Spoor is small on purpose: an extension, a bridge and an MCP server, all local. Please keep it that way: no network requests, no new permissions without discussion, and nothing that records more than [docs/PRIVACY.md](docs/PRIVACY.md) says.

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Report security and privacy problems privately, as described in [SECURITY.md](SECURITY.md), not in public issues. Never attach real recorded data to an issue or pull request.

## Setup

```bash
git clone https://github.com/martinpmm/spoor.git && cd spoor
npm install
npm run build            # bridge (tsc) + extension (wxt)
npm test                 # unit tests, both packages
npm run test:e2e         # Playwright with the extension loaded (builds first)
npm run lint && npm run format:check && npm run typecheck
```

Node 22.13 or newer (the bridge uses the built in `node:sqlite`).

For the e2e tests on a fresh machine install the browser once: `npx playwright install chromium` (CI also passes `--with-deps`).

During extension development, `npm run dev -w extension` starts WXT with hot reload in a separate browser profile.

## Layout

```
extension/   WXT + TypeScript, Manifest V3
  entrypoints/  background (navigation, sessions, storage, bridge), content (interactions), popup, options, dashboard, onboarding
  lib/          schema, db, urlTemplate, redact, sensitive, sessionizer, scope, bridgeClient, recorder, capture, analysis
  adapters/     one file per AI site
  tests/        Vitest unit tests        e2e/  Playwright end to end test
bridge/      Node: host.ts (native messaging → SQLite), mcp.ts (MCP server), store.ts, register.ts, demo.ts
fixtures/invoiceapp/   fake web app used by the e2e test (also handy by hand: npm run fixture)
analysis/    optional Python: JSONL → process map
```

## How to fix an adapter

AI chat sites change their markup often. When an adapter breaks, the dashboard shows "The _site_ adapter needs an update" and Spoor falls back to time on site only.

1. Open the site, open DevTools, and inspect the prompt box and the send button.
2. Edit the adapter in `extension/adapters/<site>.ts`:
   - `inputSelectors`: the prompt box (a `textarea` or a `contenteditable` element), most specific first.
   - `sendSelectors`: the send button, most specific first.
     Prefer stable attributes (`data-testid`, `aria-label`, `id`) over generated class names. Keep the old selectors after the new ones while both versions of the site are live.
   - `promptPaths` (optional): the paths where the prompt box is expected. If the warning names a page that has no prompt box by design (a published artifact, settings, login), the selectors are fine: leave that path out of `promptPaths` instead.
3. Update the matching markup in `extension/tests/adapters.test.ts` so the test mirrors the real page, and run `npm test -w extension`.
4. Check by hand: `npm run build`, reload the extension, send a prompt with Enter and one with the button. The dashboard's AI panel should show both, once each.
5. Open a pull request with a short note of what changed on the site (a screenshot of the DOM helps).

To add a new AI site: copy an adapter, add it to `ADAPTER_CONFIGS` in `extension/adapters/index.ts`, add its site name to `AiSite` in `extension/lib/schema.ts` and `AI_SITES` in `bridge/src/types.ts`, and add markup to the adapter test.

## Changing the event schema

Edit `extension/lib/schema.ts` and `bridge/src/types.ts` together, update `docs/EVENT_SCHEMA.md`, and add a store migration if a column changes. Breaking changes bump `v`.

## Sensitive field rules

Rules live in `extension/lib/sensitive.ts` with tests in `extension/tests/sensitive.test.ts`. Every new rule needs positive and negative cases (the word "pin" must not match "shipping"). When in doubt, exclude more, not less.

## Manual matrix before each release

- [ ] Single page apps (a web mail, a docs editor, a CRM): `nav` per view, durations make sense
- [ ] Two windows side by side: focus switches produce one `nav` per switch, one session
- [ ] Laptop sleep and wake: the page view open before sleep ends at sleep time, a new session starts
- [ ] Stop the background worker from `chrome://extensions` in the middle of a page visit: the visit keeps its duration
- [ ] Bridge stopped (`npm run unregister -w bridge`), browse, register again, "Reconnect": nothing lost
- [ ] Bridge reinstalled after `npm run build`
- [ ] A real login page and a real checkout page: check the dashboard and `~/.spoor/events.db` contain no password or card data
- [ ] Each AI adapter: one `ai_prompt` per prompt
- [ ] Exclude this site, pause 15 minutes, resume, delete all

## Releases

Bump the version in `package.json`, `extension/package.json` and `bridge/package.json` (and `BRIDGE_VERSION` in `bridge/src/constants.ts`), then push a tag `vX.Y.Z`. The release workflow builds and tests everything and attaches `spoor-extension-X.Y.Z.zip` to a GitHub release with notes generated from the merged pull requests.

## License

By contributing you agree that your contributions are licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
