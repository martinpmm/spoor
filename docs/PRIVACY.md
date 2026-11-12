# Privacy

## Use rule

**Spoor records everything a person does in the browser, including what they type. Install it only on your own browser, or with the informed consent of the person who uses that browser.**

## What Spoor records

- Sites and screens visited, as URL templates (`/invoices/{id}/edit`; query strings and fragments are dropped), with the page title (redacted) and the time spent.
- Clicks on links and buttons, form submits, copy and paste (clipboard text up to 200 characters), file uploads (file names only).
- **The final value typed into each field**, up to 1000 characters, once per field (not each keystroke).
- Prompts sent to ChatGPT, Claude, Gemini and Copilot, with their text.
- Browser focus, idle and active periods, and sessions.

## What Spoor never records, in any mode

- Fields of type password.
- Fields whose `autocomplete` attribute marks them as current password, new password, card data (`cc-*`) or one time code.
- Hidden inputs.
- Fields whose name, id, label, placeholder or aria label matches the sensitive word list: password, passcode, passphrase, PIN, CVV/CVC, secret, token, security code, card number, one time / verification code, API key, and the Spanish equivalents (contraseña, clave, código de seguridad, número de tarjeta, código de verificación, secreto, NIP…). See [`extension/lib/sensitive.ts`](../extension/lib/sensitive.ts).
- Any field inside an element marked `data-spoor="ignore"`.
- Anything in incognito windows (the extension is not allowed there, and the code checks again).
- Screenshots, page content, file contents, keystrokes.

A sensitive field produces **no event at all**: no click, no change, no copy and no paste.

Titles and element labels pass through a redactor that replaces emails, phone numbers and long digit strings. Typed values are stored as typed.

## Known limits

- A password typed into a normal field (for example a user name box), or pasted from a password manager into one, is recorded like any other text.
- Unusual login forms that do not use `type="password"` or a recognizable name are not detected.
- Mitigations: the exclude list, the "Exclude this site" button, pause (15 minutes, 1 hour, until resumed), "Record typed values" off, short retention, and delete all.

## Where the data lives

| Place                                             | What                                           | Who can read it                                     |
| ------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------- |
| IndexedDB in the extension                        | Every event, for the dashboard and as a buffer | The extension                                       |
| `~/.spoor/events.db` (if the bridge is installed) | A mirror of every event                        | Your user account only (folder `0700`, file `0600`) |
| JSONL / CSV exports                               | What you export                                | Wherever you save them                              |

The SQLite file is not encrypted. Anyone with access to your user account can read it. Encryption at rest is planned for version 2.

## What leaves the machine

The extension and the bridge make **zero network requests**. There is no server, no account and no telemetry. The bridge talks to the browser through native messaging (stdin/stdout), not a network port.

The one exception is deliberate: when you ask Claude a question, the results of the tools it calls become part of that conversation, and that includes typed values and prompt text. The setting **"Let Claude read typed values"** (on by default) controls this; with it off, every MCP tool returns lengths instead of typed values, clipboard text and prompt text.

## Retention and deletion

- Events older than 30 days (configurable) are deleted every day, in IndexedDB and in SQLite.
- "Delete all data" (dashboard or settings) empties both stores.
- Uninstalling the extension deletes IndexedDB. `npm run unregister` in `bridge` removes the native host manifest; delete `~/.spoor` to remove the SQLite file.

## Visibility

- The toolbar badge always shows **REC** or **OFF**.
- The onboarding page opens on install and states what is recorded, what is never recorded and where the data lives. It is always available from the settings page.
