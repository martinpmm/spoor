import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_VERSION } from './constants.js';
import {
  AI_SITES,
  DEFAULT_BRIDGE_SETTINGS,
  EVENT_TYPES,
  type BridgeSettings,
  type EventType,
  type SpoorEvent,
} from './types.js';

/**
 * SQLite storage for Spoor events.
 *
 * The native messaging host opens it writable; the MCP server opens it read only.
 * Uses Node's built in `node:sqlite`. If it ever proves unstable, swap the
 * implementation here: nothing outside this file touches SQL.
 */

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS events (
  id            TEXT PRIMARY KEY,
  v             INTEGER NOT NULL,
  ts            INTEGER NOT NULL,
  session_id    TEXT NOT NULL,
  tab_id        INTEGER,
  window_id     INTEGER,
  type          TEXT NOT NULL,
  domain        TEXT NOT NULL,
  url_template  TEXT NOT NULL,
  title         TEXT,
  duration_ms   INTEGER,
  element_tag   TEXT,
  element_role  TEXT,
  element_label TEXT,
  value_kind    TEXT,
  value_text    TEXT,
  value_chars   INTEGER,
  ai_site       TEXT,
  ai_chars      INTEGER,
  ai_text       TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events (ts);
CREATE INDEX IF NOT EXISTS idx_events_session ON events (session_id);
CREATE INDEX IF NOT EXISTS idx_events_domain ON events (domain);
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const UPSERT_SQL = `
INSERT INTO events (
  id, v, ts, session_id, tab_id, window_id, type, domain, url_template, title, duration_ms,
  element_tag, element_role, element_label, value_kind, value_text, value_chars, ai_site, ai_chars, ai_text
) VALUES (
  :id, :v, :ts, :session_id, :tab_id, :window_id, :type, :domain, :url_template, :title, :duration_ms,
  :element_tag, :element_role, :element_label, :value_kind, :value_text, :value_chars, :ai_site, :ai_chars, :ai_text
)
ON CONFLICT(id) DO UPDATE SET
  duration_ms = COALESCE(excluded.duration_ms, events.duration_ms),
  title = COALESCE(excluded.title, events.title)
`;

export interface EventRow {
  id: string;
  v: number;
  ts: number;
  session_id: string;
  tab_id: number | null;
  window_id: number | null;
  type: string;
  domain: string;
  url_template: string;
  title: string | null;
  duration_ms: number | null;
  element_tag: string | null;
  element_role: string | null;
  element_label: string | null;
  value_kind: string | null;
  value_text: string | null;
  value_chars: number | null;
  ai_site: string | null;
  ai_chars: number | null;
  ai_text: string | null;
}

export interface InsertResult {
  stored: string[];
  rejected: { id: string | null; reason: string }[];
}

export interface RangeFilter {
  from: number;
  to: number;
  domain?: string;
  sessionId?: string;
  types?: EventType[];
  urlTemplate?: string;
}

function clip(s: unknown, max: number): string | null {
  if (typeof s !== 'string') return null;
  return s.length > max ? s.slice(0, max) : s;
}

/** Validates an incoming event and converts it to a row. Throws with a reason when invalid. */
export function eventToRow(e: unknown): EventRow {
  if (!e || typeof e !== 'object') throw new Error('event is not an object');
  const ev = e as Partial<SpoorEvent>;
  if (typeof ev.id !== 'string' || ev.id.length === 0 || ev.id.length > 64) throw new Error('invalid id');
  if (typeof ev.ts !== 'number' || !Number.isFinite(ev.ts)) throw new Error('invalid ts');
  if (typeof ev.type !== 'string' || !(EVENT_TYPES as readonly string[]).includes(ev.type))
    throw new Error(`invalid type ${String(ev.type)}`);
  if (typeof ev.sessionId !== 'string') throw new Error('invalid sessionId');
  const ai = ev.ai && (AI_SITES as readonly string[]).includes(ev.ai.site) ? ev.ai : undefined;
  return {
    id: ev.id,
    v: typeof ev.v === 'number' ? ev.v : SCHEMA_VERSION,
    ts: Math.round(ev.ts),
    session_id: ev.sessionId,
    tab_id: typeof ev.tabId === 'number' ? ev.tabId : null,
    window_id: typeof ev.windowId === 'number' ? ev.windowId : null,
    type: ev.type,
    domain: clip(ev.domain, 255) ?? '',
    url_template: clip(ev.urlTemplate, 2000) ?? '',
    title: clip(ev.title, 500),
    duration_ms: typeof ev.durationMs === 'number' ? Math.max(0, Math.round(ev.durationMs)) : null,
    element_tag: clip(ev.element?.tag, 40),
    element_role: clip(ev.element?.role, 60),
    element_label: clip(ev.element?.label, 200),
    value_kind: clip(ev.value?.kind, 20),
    value_text: clip(ev.value?.text, 1000),
    value_chars: typeof ev.value?.chars === 'number' ? ev.value.chars : null,
    ai_site: ai ? ai.site : null,
    ai_chars: ai && typeof ai.chars === 'number' ? ai.chars : null,
    ai_text: ai ? clip(ai.text, 20000) : null,
  };
}

export function rowToEvent(r: EventRow): SpoorEvent {
  const e: SpoorEvent = {
    v: 1,
    id: r.id,
    ts: r.ts,
    sessionId: r.session_id,
    tabId: r.tab_id ?? -1,
    windowId: r.window_id ?? -1,
    type: r.type as EventType,
    domain: r.domain,
    urlTemplate: r.url_template,
  };
  if (r.title != null) e.title = r.title;
  if (r.duration_ms != null) e.durationMs = r.duration_ms;
  if (r.element_tag != null) {
    e.element = { tag: r.element_tag };
    if (r.element_role != null) e.element.role = r.element_role;
    if (r.element_label != null) e.element.label = r.element_label;
  }
  if (r.value_kind != null) {
    e.value = {
      kind: r.value_kind as NonNullable<SpoorEvent['value']>['kind'],
      text: r.value_text ?? '',
      chars: r.value_chars ?? (r.value_text ?? '').length,
    };
  }
  if (r.ai_site != null) {
    e.ai = { site: r.ai_site as NonNullable<SpoorEvent['ai']>['site'], chars: r.ai_chars ?? 0 };
    if (r.ai_text != null) e.ai.text = r.ai_text;
  }
  return e;
}

export class Store {
  readonly db: DatabaseSync;
  readonly readOnly: boolean;

  private constructor(db: DatabaseSync, readOnly: boolean) {
    this.db = db;
    this.readOnly = readOnly;
  }

  /** Opens (and creates if needed) the database for writing. Restricts permissions to the owner. */
  static openWritable(file: string): Store {
    const dir = path.dirname(file);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(dir, 0o700);
    } catch {}
    const db = new DatabaseSync(file);
    try {
      fs.chmodSync(file, 0o600);
    } catch {}
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = NORMAL;');
    db.exec('PRAGMA busy_timeout = 5000;');
    db.exec(SCHEMA_SQL);
    const store = new Store(db, false);
    store.setMeta('schema_version', String(SCHEMA_VERSION));
    return store;
  }

  /** Opens the database read only. Returns null when the file does not exist yet. */
  static openReadOnly(file: string): Store | null {
    if (!fs.existsSync(file)) return null;
    const db = new DatabaseSync(file, { readOnly: true });
    db.exec('PRAGMA busy_timeout = 5000;');
    return new Store(db, true);
  }

  /** In-memory database, used by tests. */
  static memory(): Store {
    const db = new DatabaseSync(':memory:');
    db.exec(SCHEMA_SQL);
    return new Store(db, false);
  }

  close(): void {
    try {
      this.db.close();
    } catch {}
  }

  // ---------- writes (native host) ----------

  /**
   * Inserts a batch. Inserting the same id twice is safe ("insert or ignore" semantics);
   * a later copy may only fill in `durationMs` and `title`, which the extension sets
   * when the user leaves a page.
   */
  insertEvents(events: unknown[]): InsertResult {
    if (this.readOnly) throw new Error('store is read only');
    const stmt = this.db.prepare(UPSERT_SQL);
    const result: InsertResult = { stored: [], rejected: [] };
    this.db.exec('BEGIN');
    try {
      for (const e of events) {
        let row: EventRow;
        try {
          row = eventToRow(e);
        } catch (err) {
          const id = e && typeof (e as SpoorEvent).id === 'string' ? (e as SpoorEvent).id : null;
          result.rejected.push({ id, reason: (err as Error).message });
          continue;
        }
        // A database error here aborts the whole batch (rolled back, not acknowledged, resent later).
        stmt.run(row as unknown as Record<string, string | number | null>);
        result.stored.push(row.id);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return result;
  }

  prune(beforeTs: number): number {
    const r = this.db.prepare('DELETE FROM events WHERE ts < ?').run(beforeTs);
    return Number(r.changes);
  }

  deleteAll(): number {
    const r = this.db.prepare('DELETE FROM events').run();
    try {
      this.db.exec('VACUUM');
    } catch {}
    return Number(r.changes);
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, value);
  }

  getMeta(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      { value: string } | undefined;
    return row?.value;
  }

  setSettings(settings: Partial<BridgeSettings>): BridgeSettings {
    const merged = { ...this.getSettings(), ...settings };
    this.setMeta('settings', JSON.stringify(merged));
    return merged;
  }

  getSettings(): BridgeSettings {
    const raw = this.getMeta('settings');
    if (!raw) return { ...DEFAULT_BRIDGE_SETTINGS };
    try {
      return { ...DEFAULT_BRIDGE_SETTINGS, ...(JSON.parse(raw) as Partial<BridgeSettings>) };
    } catch {
      return { ...DEFAULT_BRIDGE_SETTINGS };
    }
  }

  // ---------- reads (MCP server) ----------

  count(): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS c FROM events').get() as { c: number }).c);
  }

  range(): { first: number | null; last: number | null } {
    const r = this.db.prepare('SELECT MIN(ts) AS first, MAX(ts) AS last FROM events').get() as {
      first: number | null;
      last: number | null;
    };
    return r;
  }

  private where(f: RangeFilter): { sql: string; params: (string | number)[] } {
    const clauses = ['ts >= ?', 'ts <= ?'];
    const params: (string | number)[] = [f.from, f.to];
    if (f.domain) {
      clauses.push('(domain = ? OR domain LIKE ?)');
      params.push(f.domain, `%.${f.domain}`);
    }
    if (f.sessionId) {
      clauses.push('session_id = ?');
      params.push(f.sessionId);
    }
    if (f.urlTemplate) {
      clauses.push('url_template = ?');
      params.push(f.urlTemplate);
    }
    if (f.types && f.types.length) {
      clauses.push(`type IN (${f.types.map(() => '?').join(',')})`);
      params.push(...f.types);
    }
    return { sql: clauses.join(' AND '), params };
  }

  events(f: RangeFilter, limit = 1_000_000): SpoorEvent[] {
    const w = this.where(f);
    const rows = this.db
      .prepare(`SELECT * FROM events WHERE ${w.sql} ORDER BY ts ASC, id ASC LIMIT ?`)
      .all(...w.params, limit) as unknown as EventRow[];
    return rows.map(rowToEvent);
  }

  sessionEvents(sessionId: string): SpoorEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM events WHERE session_id = ? ORDER BY ts ASC, id ASC')
      .all(sessionId) as unknown as EventRow[];
    return rows.map(rowToEvent);
  }

  /** Text search over url templates, titles, labels, domains and (optionally) values and prompt text. */
  search(query: string, from: number, to: number, includeValues: boolean, limit: number): SpoorEvent[] {
    const like = `%${query.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    const cols = ['domain', 'url_template', 'title', 'element_label'];
    if (includeValues) cols.push('value_text', 'ai_text');
    const cond = cols.map((c) => `${c} LIKE :q ESCAPE '\\'`).join(' OR ');
    const rows = this.db
      .prepare(
        `SELECT * FROM events WHERE ts >= :from AND ts <= :to AND (${cond}) ORDER BY ts DESC LIMIT :limit`,
      )
      .all({ q: like, from, to, limit }) as unknown as EventRow[];
    return rows.map(rowToEvent);
  }

  /** Aggregates for get_overview, computed in SQL. */
  overview(from: number, to: number) {
    const totals = this.db
      .prepare(
        `SELECT COUNT(*) AS events,
                COUNT(DISTINCT session_id) AS sessions,
                COALESCE(SUM(CASE WHEN type = 'nav' THEN duration_ms END), 0) AS active_ms,
                MIN(ts) AS first_ts, MAX(ts) AS last_ts
           FROM events WHERE ts >= ? AND ts <= ?`,
      )
      .get(from, to) as {
      events: number;
      sessions: number;
      active_ms: number;
      first_ts: number;
      last_ts: number;
    };
    const byType = this.db
      .prepare(
        'SELECT type, COUNT(*) AS count FROM events WHERE ts >= ? AND ts <= ? GROUP BY type ORDER BY count DESC',
      )
      .all(from, to) as { type: string; count: number }[];
    const topSites = this.db
      .prepare(
        `SELECT domain,
                COALESCE(SUM(CASE WHEN type = 'nav' THEN duration_ms END), 0) AS active_ms,
                SUM(CASE WHEN type = 'nav' THEN 1 ELSE 0 END) AS visits,
                COUNT(*) AS events
           FROM events WHERE ts >= ? AND ts <= ? AND domain <> ''
          GROUP BY domain ORDER BY active_ms DESC, events DESC LIMIT 25`,
      )
      .all(from, to) as { domain: string; active_ms: number; visits: number; events: number }[];
    const topScreens = this.db
      .prepare(
        `SELECT domain, url_template,
                COALESCE(SUM(CASE WHEN type = 'nav' THEN duration_ms END), 0) AS active_ms,
                SUM(CASE WHEN type = 'nav' THEN 1 ELSE 0 END) AS visits,
                SUM(CASE WHEN type = 'change' THEN 1 ELSE 0 END) AS field_changes
           FROM events WHERE ts >= ? AND ts <= ? AND domain <> ''
          GROUP BY domain, url_template ORDER BY active_ms DESC, visits DESC LIMIT 25`,
      )
      .all(from, to) as {
      domain: string;
      url_template: string;
      active_ms: number;
      visits: number;
      field_changes: number;
    }[];
    const navs = this.db
      .prepare(
        `SELECT ts, duration_ms FROM events WHERE type = 'nav' AND ts >= ? AND ts <= ? AND duration_ms > 0`,
      )
      .all(from, to) as { ts: number; duration_ms: number }[];
    return { totals, byType, topSites, topScreens, navs };
  }
}

/** Ensures the directory of the database exists with owner-only permissions. */
export function ensureDataDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {}
}
