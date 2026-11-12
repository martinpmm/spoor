import type { SpoorEvent, StoredEvent } from './schema';

/**
 * IndexedDB layer. Feeds the dashboard and works as the buffer for the bridge:
 * every event starts with synced = 0 and is flipped to 1 when the bridge confirms it.
 */

const DB_NAME = 'spoor';
const DB_VERSION = 1;
const STORE = 'events';
/** Names the database had before the project was renamed. Their events are moved into DB_NAME. */
const LEGACY_DB_NAMES = ['rastro', 'meerkat'];
const MIGRATE_BATCH = 2000;

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = openCurrent(factory).then(async (db) => {
    try {
      await migrateLegacy(db, factory);
    } catch (err) {
      // The old database stays in place and the move is tried again on the next open.
      console.warn('[spoor] could not move events from an older database', err);
    }
    return db;
  });
  return dbPromise;
}

function openCurrent(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: 'id' });
        s.createIndex('ts', 'ts');
        s.createIndex('sessionId', 'sessionId');
        s.createIndex('domain', 'domain');
        s.createIndex('synced_ts', ['synced', 'ts']);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
}

/**
 * Moves events recorded under an older database name into the current one, then deletes the
 * old database. Safe to run from the background worker and a page at the same time, and to run
 * again: an event that is already in the current database is never overwritten.
 *
 * Moved events are marked unsynced, because the bridge was renamed too and starts with an empty
 * file: sending them again fills it (the bridge stores by event id, so nothing is duplicated).
 */
async function migrateLegacy(db: IDBDatabase, factory: IDBFactory): Promise<void> {
  if (typeof factory.databases !== 'function') return;
  const existing = new Set((await factory.databases()).map((d) => d.name));
  for (const name of LEGACY_DB_NAMES) {
    if (!existing.has(name)) continue;
    const old = await request(factory.open(name));
    try {
      if (old.objectStoreNames.contains(STORE)) {
        let after: string | undefined;
        for (;;) {
          const range = after === undefined ? undefined : IDBKeyRange.lowerBound(after, true);
          const batch = (await request(
            old.transaction(STORE).objectStore(STORE).getAll(range, MIGRATE_BATCH),
          )) as StoredEvent[];
          if (!batch.length) break;
          const tx = db.transaction(STORE, 'readwrite');
          const s = tx.objectStore(STORE);
          for (const e of batch) {
            const present = s.getKey(e.id);
            present.onsuccess = () => {
              if (present.result === undefined) s.put({ ...e, synced: 0 } satisfies StoredEvent);
            };
          }
          await done(tx);
          after = batch[batch.length - 1].id;
        }
      }
    } finally {
      old.close();
    }
    await new Promise<void>((resolve, reject) => {
      const del = factory.deleteDatabase(name);
      del.onsuccess = () => resolve();
      del.onerror = () => reject(del.error);
      // Another context still has it open: the delete finishes once that one closes.
      del.onblocked = () => resolve();
    });
  }
}

/** For tests: forget the cached connection. */
export function resetDbForTests(): void {
  dbPromise = null;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putEvents(events: SpoorEvent[], synced: 0 | 1 = 0): Promise<void> {
  if (!events.length) return;
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  const s = tx.objectStore(STORE);
  for (const e of events) s.put({ ...e, synced } satisfies StoredEvent);
  await done(tx);
}

export async function getEvent(id: string): Promise<StoredEvent | undefined> {
  const db = await openDb();
  return request(db.transaction(STORE).objectStore(STORE).get(id)) as Promise<StoredEvent | undefined>;
}

/** Applies a patch to an event and marks it for resending (used to write durationMs and title). */
export async function patchEvent(id: string, patch: Partial<SpoorEvent>): Promise<StoredEvent | undefined> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  const s = tx.objectStore(STORE);
  const current = (await request(s.get(id))) as StoredEvent | undefined;
  let next: StoredEvent | undefined;
  if (current) {
    next = { ...current, ...patch, synced: 0 };
    s.put(next);
  }
  await done(tx);
  return next;
}

/** Oldest unsynced events first. */
export async function getUnsynced(limit: number): Promise<StoredEvent[]> {
  const db = await openDb();
  const idx = db.transaction(STORE).objectStore(STORE).index('synced_ts');
  const range = IDBKeyRange.bound([0, -Infinity], [0, Infinity]);
  return request(idx.getAll(range, limit)) as Promise<StoredEvent[]>;
}

export async function countUnsynced(): Promise<number> {
  const db = await openDb();
  const idx = db.transaction(STORE).objectStore(STORE).index('synced_ts');
  return request(idx.count(IDBKeyRange.bound([0, -Infinity], [0, Infinity])));
}

/**
 * Marks events as confirmed by the bridge. When `sent` is given, an event is only marked if
 * its duration and title are still the ones that were sent: a nav event patched while the
 * batch was in flight stays unsynced and is sent again.
 */
export async function markSynced(ids: string[], sent?: Map<string, SpoorEvent>): Promise<void> {
  if (!ids.length) return;
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  const s = tx.objectStore(STORE);
  for (const id of ids) {
    const r = s.get(id);
    r.onsuccess = () => {
      const e = r.result as StoredEvent | undefined;
      if (!e || e.synced === 1) return;
      const before = sent?.get(id);
      if (before && (before.durationMs !== e.durationMs || before.title !== e.title)) return;
      s.put({ ...e, synced: 1 });
    };
  }
  await done(tx);
}

export async function getEventsInRange(from: number, to: number): Promise<StoredEvent[]> {
  const db = await openDb();
  const idx = db.transaction(STORE).objectStore(STORE).index('ts');
  return request(idx.getAll(IDBKeyRange.bound(from, to))) as Promise<StoredEvent[]>;
}

export async function countInRange(from: number, to: number): Promise<number> {
  const db = await openDb();
  const idx = db.transaction(STORE).objectStore(STORE).index('ts');
  return request(idx.count(IDBKeyRange.bound(from, to)));
}

export async function countAll(): Promise<number> {
  const db = await openDb();
  return request(db.transaction(STORE).objectStore(STORE).count());
}

/** Deletes events older than `before`. Returns how many were removed. */
export async function deleteBefore(before: number): Promise<number> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  const idx = tx.objectStore(STORE).index('ts');
  let n = 0;
  const cursorReq = idx.openCursor(IDBKeyRange.upperBound(before, true));
  cursorReq.onsuccess = () => {
    const c = cursorReq.result;
    if (!c) return;
    c.delete();
    n++;
    c.continue();
  };
  await done(tx);
  return n;
}

export async function clearAll(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).clear();
  await done(tx);
}
