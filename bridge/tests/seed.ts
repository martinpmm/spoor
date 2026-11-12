import type { SpoorEvent } from '../src/types.js';

let counter = 0;
export function ev(partial: Partial<SpoorEvent> & Pick<SpoorEvent, 'type' | 'ts'>): SpoorEvent {
  counter++;
  return {
    v: 1,
    id: partial.id ?? `e${String(counter).padStart(6, '0')}`,
    sessionId: 's1',
    tabId: 1,
    windowId: 1,
    domain: 'erp.example.com',
    urlTemplate: '/',
    ...partial,
  };
}

/** Base time: Monday 2026-11-09 09:00 local. */
export const T0 = new Date(2026, 10, 9, 9, 0, 0).getTime();
const MIN = 60_000;

/**
 * A realistic day: the "copy invoice from ERP to bank" workflow repeated 4 times,
 * plus some noise and AI prompts.
 */
export function seedDay(base = T0, sessionId = 's1'): SpoorEvent[] {
  const out: SpoorEvent[] = [];
  let t = base;
  for (let i = 0; i < 4; i++) {
    out.push(
      ev({
        sessionId,
        type: 'nav',
        ts: t,
        domain: 'erp.example.com',
        urlTemplate: '/invoices',
        title: 'Invoices',
        durationMs: MIN,
      }),
    );
    t += MIN;
    out.push(
      ev({
        sessionId,
        type: 'nav',
        ts: t,
        domain: 'erp.example.com',
        urlTemplate: '/invoices/{id}',
        title: 'Invoice',
        durationMs: 2 * MIN,
      }),
    );
    out.push(
      ev({
        sessionId,
        type: 'copy',
        ts: t + 30_000,
        domain: 'erp.example.com',
        urlTemplate: '/invoices/{id}',
        value: { kind: 'clipboard', text: `ES12 3456 7890 ${i}`, chars: 16 },
      }),
    );
    t += 2 * MIN;
    out.push(
      ev({
        sessionId,
        type: 'nav',
        ts: t,
        domain: 'bank.example.com',
        urlTemplate: '/transfers/new',
        title: 'New transfer',
        durationMs: 3 * MIN,
      }),
    );
    out.push(
      ev({
        sessionId,
        type: 'paste',
        ts: t + 10_000,
        domain: 'bank.example.com',
        urlTemplate: '/transfers/new',
        element: { tag: 'input', label: 'IBAN' },
        value: { kind: 'clipboard', text: `ES12 3456 7890 ${i}`, chars: 16 },
      }),
    );
    out.push(
      ev({
        sessionId,
        type: 'change',
        ts: t + 20_000,
        domain: 'bank.example.com',
        urlTemplate: '/transfers/new',
        element: { tag: 'input', label: 'Concept' },
        value: { kind: 'text', text: 'Invoice payment', chars: 15 },
      }),
    );
    out.push(
      ev({
        sessionId,
        type: 'click',
        ts: t + 40_000,
        domain: 'bank.example.com',
        urlTemplate: '/transfers/new',
        element: { tag: 'button', label: 'Send transfer' },
      }),
    );
    t += 3 * MIN;
    out.push(
      ev({
        sessionId,
        type: 'nav',
        ts: t,
        domain: 'news.example.org',
        urlTemplate: '/',
        title: 'News',
        durationMs: MIN,
      }),
    );
    t += MIN;
  }
  out.push(
    ev({
      sessionId,
      type: 'nav',
      ts: t,
      domain: 'claude.ai',
      urlTemplate: '/chat/{uuid}',
      durationMs: 5 * MIN,
    }),
  );
  out.push(
    ev({
      sessionId,
      type: 'ai_prompt',
      ts: t + 1000,
      domain: 'claude.ai',
      urlTemplate: '/chat/{uuid}',
      ai: { site: 'claude', chars: 28, text: 'Summarize this invoice email' },
    }),
  );
  out.push(
    ev({ sessionId, type: 'idle', ts: t + 5 * MIN, domain: 'claude.ai', urlTemplate: '/chat/{uuid}' }),
  );
  return out;
}
