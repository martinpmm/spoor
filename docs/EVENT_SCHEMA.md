# Event schema (version 1)

One row per event. The same shape is stored in IndexedDB (plus a `synced` flag), sent to the bridge, stored in SQLite (`~/.spoor/events.db`, snake_case columns) and exported as JSONL.

Source of truth: [`extension/lib/schema.ts`](../extension/lib/schema.ts), mirrored in [`bridge/src/types.ts`](../bridge/src/types.ts).

```ts
type EventType =
  | 'nav'
  | 'focus'
  | 'blur'
  | 'idle'
  | 'active'
  | 'click'
  | 'submit'
  | 'change'
  | 'copy'
  | 'paste'
  | 'upload'
  | 'ai_prompt';

interface SpoorEvent {
  v: 1; // schema version
  id: string; // uuid
  ts: number; // epoch milliseconds
  sessionId: string;
  tabId: number; // -1 for browser level events
  windowId: number; // -1 when unknown
  type: EventType;
  domain: string; // "erp.example.com" (lower case, without "www."), "" for browser level events
  urlTemplate: string; // "/invoices/{id}/edit"
  title?: string; // page title, redacted
  durationMs?: number; // nav only: filled when the user leaves the page
  element?: {
    tag: string; // "button", "input", "a", "form"
    role?: string; // ARIA role, or the input type for inputs
    label?: string; // visible label or aria label, redacted, max 60 characters
  };
  value?: {
    kind: 'text' | 'select' | 'checkbox' | 'file' | 'clipboard';
    text: string; // final value, trimmed to 1000 characters (clipboard: 200). "" when value capture is off
    chars: number; // original length
  };
  ai?: {
    site: 'chatgpt' | 'claude' | 'gemini' | 'copilot';
    chars: number;
    text?: string; // prompt text, absent when "Record AI prompt text" is off
  };
}
```

## Event types

| Type        | Emitted by            | When                                                                                                                                                                                  | Fields                                                                                |
| ----------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `nav`       | background            | The page with the user's attention changes: tab activated, navigation committed (including reloads), `history.pushState` in single page apps, window focus regained, return from idle | `title`, `durationMs` (written when the user leaves)                                  |
| `focus`     | background            | The browser gets focus back from another application                                                                                                                                  |                                                                                       |
| `blur`      | background            | The browser loses focus to another application                                                                                                                                        | domain/template of the page that was open                                             |
| `idle`      | background            | 5 minutes without input, or the screen locked. `ts` is when input stopped                                                                                                             | domain/template of the page that was open                                             |
| `active`    | background            | Input again after idle. Starts a new session                                                                                                                                          |                                                                                       |
| `click`     | content               | Click on a link, button or other control (clicks into fields are not recorded; `change` describes them)                                                                               | `element`                                                                             |
| `submit`    | content               | Form submitted                                                                                                                                                                        | `element` (tag `form`, label from aria label or the submit button)                    |
| `change`    | content               | Final value of a field: on change for inputs, selects and checkboxes; on blur for rich text editors                                                                                   | `element`, `value`                                                                    |
| `copy`      | content               | Copy or cut                                                                                                                                                                           | `element` (field or control, or just the tag for page text), `value.kind = clipboard` |
| `paste`     | content               | Paste into a field                                                                                                                                                                    | `element`, `value.kind = clipboard`                                                   |
| `upload`    | content               | File chosen in a file input, dropped, or pasted                                                                                                                                       | `element`, `value.kind = file` (file names only, never content)                       |
| `ai_prompt` | content (AI adapters) | Prompt sent on chatgpt.com, claude.ai, gemini.google.com or copilot.microsoft.com                                                                                                     | `ai`                                                                                  |

## URL templates

- Query string and fragment are dropped, except the per site keys configured in settings (for example `tab` or `view`).
- Numeric path segments become `{id}`, uuids `{uuid}`, emails `{email}`, and segments of 16 or more characters mixing letters and digits `{token}`.

## Sessions

A new session starts when the browser starts, after 5 minutes idle, or when more than 5 minutes passed since the previous event (laptop sleep). Sessions are per browser: two windows used side by side share one.

## Activities

The analysis groups events into activities: `domain + urlTemplate · type "label"`, for example `bank.example.com/transfers/new · paste "IBAN"`. Consecutive identical activities in a session are collapsed. Repeated sequences of activities are the candidate workflows.

## SQLite

```sql
CREATE TABLE events (
  id TEXT PRIMARY KEY, v INTEGER, ts INTEGER, session_id TEXT, tab_id INTEGER, window_id INTEGER,
  type TEXT, domain TEXT, url_template TEXT, title TEXT, duration_ms INTEGER,
  element_tag TEXT, element_role TEXT, element_label TEXT,
  value_kind TEXT, value_text TEXT, value_chars INTEGER,
  ai_site TEXT, ai_chars INTEGER, ai_text TEXT
);
-- indexes on ts, session_id, domain
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
-- meta: schema_version, settings ({"claudeReadsValues": true, "retentionDays": 30})
```

Inserts are idempotent: resending an event with the same `id` only fills in `duration_ms` and `title` (never erases them).

## Versioning

`v` is incremented on any breaking change. Readers must ignore unknown fields. A future version adds a migration in `bridge/src/store.ts` keyed on `meta.schema_version`.
