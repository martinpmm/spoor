import { describe, expect, it } from 'vitest';
import { topSequences } from '../src/analysis.js';
import { generateWeek } from '../src/demo.js';
import { Store } from '../src/store.js';

describe('demo data', () => {
  it('produces the five planned workflows as the top repeated sequences', () => {
    const events = generateWeek(new Date(2026, 10, 2));
    const store = Store.memory();
    const r = store.insertEvents(events);
    expect(r.rejected).toEqual([]);
    const seqs = topSequences(events, 3, 3, 50);
    const text = seqs.map((s) => s.steps.join(' > ')).join('\n');
    for (const d of [
      'helpdesk.example.com',
      'bank.example.com',
      'crm.example.com',
      'expenses.example.com',
      'docs.google.com',
    ]) {
      expect(text).toContain(d);
    }
    expect(seqs[0].count).toBeGreaterThanOrEqual(45); // ticket triage, 10 per day
  });
});
