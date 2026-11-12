import { describe, expect, it } from 'vitest';
import {
  activityKey,
  aiSummary,
  summaryForClaude,
  timePerDay,
  timePerSite,
  topSequences,
} from '../lib/analysis';
import { toCsv, toJsonl } from '../lib/exporters';
import type { SpoorEvent, StoredEvent } from '../lib/schema';

let i = 0;
const ev = (p: Partial<SpoorEvent> & Pick<SpoorEvent, 'type' | 'ts'>): StoredEvent => ({
  v: 1,
  id: `e${++i}`,
  sessionId: 's1',
  tabId: 1,
  windowId: 1,
  domain: 'erp.com',
  urlTemplate: '/',
  synced: 0,
  ...p,
});

const T0 = new Date(2026, 10, 9, 9).getTime();
function workflow(base: number): StoredEvent[] {
  return [
    ev({ type: 'nav', ts: base, urlTemplate: '/invoices', durationMs: 60_000 }),
    ev({ type: 'nav', ts: base + 60_000, urlTemplate: '/invoices/{id}', durationMs: 60_000 }),
    ev({
      type: 'copy',
      ts: base + 70_000,
      urlTemplate: '/invoices/{id}',
      value: { kind: 'clipboard', text: 'ES12', chars: 4 },
    }),
    ev({
      type: 'nav',
      ts: base + 120_000,
      domain: 'bank.com',
      urlTemplate: '/transfer',
      durationMs: 180_000,
    }),
    ev({
      type: 'paste',
      ts: base + 130_000,
      domain: 'bank.com',
      urlTemplate: '/transfer',
      element: { tag: 'input', label: 'IBAN' },
    }),
  ];
}

describe('dashboard analysis', () => {
  const events = [0, 1, 2].flatMap((k) => workflow(T0 + k * 600_000));

  it('activity keys match the bridge format', () => {
    expect(
      activityKey(ev({ type: 'click', ts: 0, urlTemplate: '/a', element: { tag: 'button', label: 'Go' } })),
    ).toBe('erp.com/a · click "Go"');
  });

  it('finds repeated sequences', () => {
    const s = topSequences(events, 5, 3);
    expect(s[0].count).toBe(3);
    expect(s[0].steps[0]).toBe('erp.com/invoices · nav');
  });

  it('time per site and day', () => {
    expect(timePerSite(events)[0]).toMatchObject({ domain: 'bank.com', activeMs: 540_000, visits: 3 });
    const days = timePerDay(events, T0 - 86_400_000, T0 + 3_600_000);
    expect(days).toHaveLength(2);
    expect(days[1].activeMs).toBe(900_000);
  });

  it('AI summary', () => {
    expect(aiSummary([ev({ type: 'ai_prompt', ts: 0, ai: { site: 'claude', chars: 10 } })])).toEqual([
      { site: 'claude', prompts: 1, avgChars: 10 },
    ]);
  });

  it('summary for Claude names sites and sequences', () => {
    const text = summaryForClaude(events, T0, T0 + 3_600_000);
    expect(text).toContain('bank.com');
    expect(text).toContain('3×');
    expect(text).toContain('automate with an agent');
  });

  it('exports JSONL without the sync flag, and valid CSV', () => {
    const jsonl = toJsonl(events.slice(0, 2));
    const lines = jsonl
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0].synced).toBeUndefined();
    const csv = toCsv([ev({ type: 'change', ts: 0, value: { kind: 'text', text: 'a, "b"\nc', chars: 8 } })]);
    expect(csv.split('\r\n')[1]).toContain('"a, ""b""\nc"');
  });
});
