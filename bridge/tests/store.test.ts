import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Store } from '../src/store.js';
import { ev, seedDay, T0 } from './seed.js';

describe('store', () => {
  it('inserts are idempotent', () => {
    const s = Store.memory();
    const events = seedDay();
    const r1 = s.insertEvents(events);
    expect(r1.stored).toHaveLength(events.length);
    expect(r1.rejected).toHaveLength(0);
    const r2 = s.insertEvents(events);
    expect(r2.stored).toHaveLength(events.length);
    expect(s.count()).toBe(events.length);
  });

  it('a resent nav event can fill in its duration and title, but never erases them', () => {
    const s = Store.memory();
    const e = ev({ id: 'nav1', type: 'nav', ts: T0 });
    s.insertEvents([e]);
    expect(s.sessionEvents('s1')[0].durationMs).toBeUndefined();
    s.insertEvents([{ ...e, durationMs: 4200, title: 'Invoices' }]);
    expect(s.sessionEvents('s1')[0]).toMatchObject({ durationMs: 4200, title: 'Invoices' });
    s.insertEvents([e]);
    expect(s.sessionEvents('s1')[0]).toMatchObject({ durationMs: 4200, title: 'Invoices' });
  });

  it('rejects invalid events without failing the batch', () => {
    const s = Store.memory();
    const r = s.insertEvents([
      ev({ type: 'nav', ts: T0 }),
      { id: 'bad', type: 'nope', ts: 1, sessionId: 's' },
      null,
    ]);
    expect(r.stored).toHaveLength(1);
    expect(r.rejected.map((x) => x.id)).toEqual(['bad', null]);
  });

  it('round-trips every field', () => {
    const s = Store.memory();
    const e = ev({
      type: 'change',
      ts: T0,
      title: 't',
      element: { tag: 'input', role: 'textbox', label: 'Amount' },
      value: { kind: 'text', text: '120.50', chars: 6 },
    });
    const a = ev({ type: 'ai_prompt', ts: T0 + 1, ai: { site: 'chatgpt', chars: 5, text: 'hello' } });
    s.insertEvents([e, a]);
    const [r1, r2] = s.sessionEvents('s1');
    expect(r1).toEqual(e);
    expect(r2).toEqual(a);
  });

  it('computes overview aggregates', () => {
    const s = Store.memory();
    s.insertEvents(seedDay());
    const o = s.overview(T0 - 1, T0 + 86_400_000);
    // 4 × (1 + 2 + 3 + 1) minutes + 5 minutes on claude.ai
    expect(o.totals.active_ms).toBe((4 * 7 + 5) * 60_000);
    expect(o.topSites[0]).toMatchObject({ domain: 'bank.example.com', active_ms: 12 * 60_000, visits: 4 });
    expect(o.byType.find((t) => t.type === 'paste')?.count).toBe(4);
  });

  it('filters by range, domain (with subdomains), types and url template', () => {
    const s = Store.memory();
    s.insertEvents(seedDay());
    expect(s.events({ from: 0, to: T0 + 1e9, domain: 'example.com', types: ['nav'] }).length).toBe(12);
    expect(
      s.events({
        from: 0,
        to: T0 + 1e9,
        domain: 'bank.example.com',
        urlTemplate: '/transfers/new',
        types: ['change'],
      }).length,
    ).toBe(4);
    expect(s.events({ from: T0 + 1e9, to: T0 + 2e9 }).length).toBe(0);
  });

  it('search escapes LIKE wildcards and respects the values flag', () => {
    const s = Store.memory();
    s.insertEvents(seedDay());
    expect(s.search('Send transfer', 0, T0 + 1e9, false, 50)).toHaveLength(4);
    expect(s.search('Invoice payment', 0, T0 + 1e9, false, 50)).toHaveLength(0);
    expect(s.search('Invoice payment', 0, T0 + 1e9, true, 50)).toHaveLength(4);
    expect(s.search('%', 0, T0 + 1e9, true, 50)).toHaveLength(0);
  });

  it('prunes, deletes all, and stores settings', () => {
    const s = Store.memory();
    s.insertEvents(seedDay());
    const n = s.count();
    expect(s.prune(T0 + 60_000)).toBe(1);
    expect(s.count()).toBe(n - 1);
    expect(s.deleteAll()).toBe(n - 1);
    expect(s.count()).toBe(0);
    expect(s.getSettings().claudeReadsValues).toBe(true);
    s.setSettings({ claudeReadsValues: false });
    expect(s.getSettings().claudeReadsValues).toBe(false);
  });

  it('creates the file with owner-only permissions and reopens it read only', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spoor-'));
    const file = path.join(dir, 'sub', 'events.db');
    const w = Store.openWritable(file);
    w.insertEvents(seedDay());
    if (process.platform !== 'win32') {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
    }
    const r = Store.openReadOnly(file)!;
    expect(r.count()).toBe(w.count());
    expect(() => r.insertEvents([ev({ type: 'nav', ts: 1 })])).toThrow();
    r.close();
    w.close();
    expect(Store.openReadOnly(path.join(dir, 'missing.db'))).toBeNull();
  });
});
