import { describe, expect, it } from 'vitest';
import {
  activeHours,
  activityKey,
  aiUsage,
  fieldValues,
  maskEvent,
  siteSwitches,
  summarizeSessions,
  topSequences,
} from '../src/analysis.js';
import { ev, seedDay, T0 } from './seed.js';

describe('analysis', () => {
  it('builds activity keys from domain, template, type and label', () => {
    expect(
      activityKey(
        ev({ type: 'click', ts: 0, urlTemplate: '/x/{id}', element: { tag: 'button', label: 'Save' } }),
      ),
    ).toBe('erp.example.com/x/{id} · click "Save"');
  });

  it('finds the repeated workflow', () => {
    const seqs = topSequences(seedDay(), 4, 3);
    expect(seqs.length).toBeGreaterThan(0);
    const top = seqs[0];
    expect(top.count).toBe(4);
    expect(top.steps.join(' | ')).toContain('bank.example.com/transfers/new');
  });

  it('does not count overlapping occurrences twice', () => {
    const events = [];
    let t = T0;
    for (let i = 0; i < 6; i++) {
      events.push(ev({ type: 'nav', ts: (t += 1000), urlTemplate: i % 2 ? '/b' : '/a' }));
    }
    const seqs = topSequences(events, 2, 1);
    const ab = seqs.find((s) => s.steps[0].includes('/a') && s.steps[1].includes('/b'))!;
    expect(ab.count).toBe(3);
  });

  it('summarizes sessions', () => {
    const sessions = summarizeSessions([...seedDay(T0, 'a'), ...seedDay(T0 + 86_400_000, 'b')]);
    expect(sessions.map((s) => s.sessionId)).toEqual(['a', 'b']);
    expect(sessions[0].mainSites[0].domain).toBe('bank.example.com');
    expect(sessions[0].activeMs).toBe(33 * 60_000);
  });

  it('counts site switches and cross-site copy/paste', () => {
    const pairs = siteSwitches(seedDay(), true);
    const p = pairs.find((x) => x.from === 'erp.example.com' && x.to === 'bank.example.com')!;
    expect(p.switches).toBe(4);
    expect(p.copyPaste).toBe(4);
    expect(p.samples[0].copied).toContain('ES12');
    const masked = siteSwitches(seedDay(), false);
    expect(masked[0].samples.every((s) => s.copied === '')).toBe(true);
  });

  it('groups field values and hides them when not allowed', () => {
    const f = fieldValues(seedDay(), true);
    expect(f[0]).toMatchObject({ label: 'Concept', count: 4, distinctValues: 1 });
    expect(f[0].topValues[0]).toMatchObject({ value: 'Invoice payment', count: 4 });
    expect(fieldValues(seedDay(), false)[0].topValues[0].value).toBeNull();
  });

  it('reports AI usage', () => {
    const u = aiUsage(seedDay(), true);
    expect(u.totalPrompts).toBe(1);
    expect(u.bySite[0]).toMatchObject({ site: 'claude', prompts: 1 });
    expect(u.prompts[0].text).toBe('Summarize this invoice email');
    expect(u.timeOnSitesMs[0]).toMatchObject({ site: 'claude', activeMs: 5 * 60_000 });
    expect(aiUsage(seedDay(), false).prompts[0].text).toBeNull();
  });

  it('masks values and prompt text, keeping lengths', () => {
    const e = ev({ type: 'change', ts: 0, value: { kind: 'text', text: 'secret-ish', chars: 10 } });
    expect(maskEvent(e, false)).toMatchObject({ value: { text: '', chars: 10 }, valuesHidden: true });
    expect(maskEvent(e, true)).toBe(e);
    const a = ev({ type: 'ai_prompt', ts: 0, ai: { site: 'chatgpt', chars: 3, text: 'abc' } });
    expect(maskEvent(a, false).ai).toEqual({ site: 'chatgpt', chars: 3 });
  });

  it('splits active time across hours', () => {
    const start = new Date(2026, 10, 9, 9, 50).getTime();
    const h = activeHours([{ ts: start, duration_ms: 20 * 60_000 }]);
    expect(h).toEqual([
      { hour: 9, activeMs: 10 * 60_000 },
      { hour: 10, activeMs: 10 * 60_000 },
    ]);
  });
});
