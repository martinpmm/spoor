import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearAll,
  countAll,
  countUnsynced,
  deleteBefore,
  getEventsInRange,
  getUnsynced,
  markSynced,
  patchEvent,
  putEvents,
  resetDbForTests,
} from '../lib/db';
import type { SpoorEvent } from '../lib/schema';

const ev = (id: string, ts: number, extra: Partial<SpoorEvent> = {}): SpoorEvent => ({
  v: 1,
  id,
  ts,
  sessionId: 's',
  tabId: 1,
  windowId: 1,
  type: 'nav',
  domain: 'a.com',
  urlTemplate: '/',
  ...extra,
});

describe('db', () => {
  beforeEach(async () => {
    resetDbForTests();
    await clearAll();
  });

  it('stores events unsynced and returns them oldest first', async () => {
    await putEvents([ev('c', 30), ev('a', 10), ev('b', 20)]);
    expect(await countUnsynced()).toBe(3);
    expect((await getUnsynced(2)).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('marks synced, and a patch makes the event unsynced again', async () => {
    await putEvents([ev('a', 10), ev('b', 20)]);
    await markSynced(['a', 'b']);
    expect(await countUnsynced()).toBe(0);
    const p = await patchEvent('a', { durationMs: 500 });
    expect(p).toMatchObject({ durationMs: 500, synced: 0 });
    expect((await getUnsynced(10)).map((e) => e.id)).toEqual(['a']);
  });

  it('does not mark an event that was patched while its batch was in flight', async () => {
    await putEvents([ev('a', 10)]);
    const [sent] = await getUnsynced(10);
    await patchEvent('a', { durationMs: 900 });
    await markSynced(['a'], new Map([['a', sent]]));
    expect(await countUnsynced()).toBe(1);
  });

  it('range queries, retention and delete all', async () => {
    await putEvents([ev('a', 10), ev('b', 20), ev('c', 30)]);
    expect((await getEventsInRange(15, 30)).map((e) => e.id).sort()).toEqual(['b', 'c']);
    expect(await deleteBefore(20)).toBe(1);
    expect(await countAll()).toBe(2);
    await clearAll();
    expect(await countAll()).toBe(0);
  });

  describe('databases from before the rename', () => {
    function seedLegacy(name: string, rows: (SpoorEvent & { synced: 0 | 1 })[]): Promise<void> {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(name, 1);
        req.onupgradeneeded = () => {
          const s = req.result.createObjectStore('events', { keyPath: 'id' });
          s.createIndex('ts', 'ts');
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('events', 'readwrite');
          for (const r of rows) tx.objectStore('events').put(r);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
    }
    const names = async () => (await indexedDB.databases()).map((d) => d.name);

    it('moves their events into the current database, unsynced, and deletes them', async () => {
      await seedLegacy('rastro', [
        { ...ev('old1', 10), synced: 1 },
        { ...ev('old2', 20, { durationMs: 5 }), synced: 0 },
      ]);
      await seedLegacy('meerkat', [{ ...ev('old3', 30), synced: 1 }]);
      resetDbForTests();

      const all = await getEventsInRange(0, 100);
      expect(all.map((e) => e.id)).toEqual(['old1', 'old2', 'old3']);
      expect(all.find((e) => e.id === 'old2')?.durationMs).toBe(5);
      expect(await countUnsynced()).toBe(3); // sent again to the renamed bridge
      expect(await names()).toEqual(['spoor']);
    });

    it('never overwrites an event that is already in the current database', async () => {
      await putEvents([ev('same', 10, { title: 'current' })], 1);
      await seedLegacy('rastro', [
        { ...ev('same', 10, { title: 'old' }), synced: 0 },
        { ...ev('other', 20), synced: 1 },
      ]);
      resetDbForTests();

      const all = await getEventsInRange(0, 100);
      expect(all.map((e) => [e.id, e.title, e.synced])).toEqual([
        ['same', 'current', 1],
        ['other', undefined, 0],
      ]);
    });

    it('moves more events than fit in one batch', async () => {
      const many = Array.from({ length: 4500 }, (_, i) => ({
        ...ev(`e${String(i).padStart(5, '0')}`, i),
        synced: 1 as const,
      }));
      await seedLegacy('rastro', many);
      resetDbForTests();
      expect(await countAll()).toBe(4500);
      expect(await names()).toEqual(['spoor']);
    });
  });
});
