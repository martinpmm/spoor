import type { SpoorEvent } from './schema';

/**
 * Dashboard analytics over events loaded from IndexedDB.
 * Activity keys and the sequence counter match bridge/src/analysis.ts, so the dashboard
 * and Claude see the same workflows.
 */

const ACTIVITY_TYPES = new Set(['nav', 'click', 'submit', 'change', 'copy', 'paste', 'upload', 'ai_prompt']);

export function activityKey(e: SpoorEvent): string {
  const label = e.element?.label ? ` "${e.element.label}"` : '';
  const site = e.ai ? ` [${e.ai.site}]` : '';
  return `${e.domain}${e.urlTemplate} · ${e.type}${label}${site}`;
}

function eventEnd(e: SpoorEvent): number {
  return e.ts + (e.type === 'nav' && e.durationMs ? e.durationMs : 0);
}

export interface Sequence {
  steps: string[];
  count: number;
  sessions: number;
  avgDurationMs: number;
}

export function topSequences(events: SpoorEvent[], length = 4, minCount = 3, limit = 10): Sequence[] {
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  const bySession = new Map<string, { key: string; start: number; end: number }[]>();
  for (const e of sorted) {
    if (!ACTIVITY_TYPES.has(e.type)) continue;
    const key = activityKey(e);
    let l = bySession.get(e.sessionId);
    if (!l) bySession.set(e.sessionId, (l = []));
    const last = l[l.length - 1];
    if (last && last.key === key) {
      last.end = Math.max(last.end, eventEnd(e));
      continue;
    }
    l.push({ key, start: e.ts, end: eventEnd(e) });
  }
  const stats = new Map<string, { steps: string[]; count: number; sessions: Set<string>; total: number }>();
  for (const [sid, acts] of bySession) {
    const lastEnd = new Map<string, number>();
    for (let i = 0; i + length <= acts.length; i++) {
      const w = acts.slice(i, i + length);
      const steps = w.map((a) => a.key);
      if (length > 1 && new Set(steps).size === 1) continue;
      const k = steps.join('\u0001');
      const prev = lastEnd.get(k);
      if (prev !== undefined && i < prev) continue;
      lastEnd.set(k, i + length);
      let s = stats.get(k);
      if (!s) stats.set(k, (s = { steps, count: 0, sessions: new Set(), total: 0 }));
      s.count++;
      s.sessions.add(sid);
      s.total += Math.max(0, w[w.length - 1].end - w[0].start);
    }
  }
  const sorted2 = [...stats.values()]
    .filter((s) => s.count >= minCount)
    .map((s) => ({
      steps: s.steps,
      count: s.count,
      sessions: s.sessions.size,
      avgDurationMs: Math.round(s.total / s.count),
    }))
    .sort((a, b) => b.count - a.count || b.avgDurationMs - a.avgDurationMs);
  return collapseShifted(sorted2).slice(0, limit);
}

/** Same as bridge/src/analysis.ts: drop windows of one workflow shifted by a step. */
export function collapseShifted<T extends { steps: string[]; count: number }>(sorted: T[]): T[] {
  const seen: T[] = [];
  const kept: T[] = [];
  const key = (a: string[]) => a.join('\u0001');
  for (const s of sorted) {
    const head = key(s.steps.slice(0, -1));
    const tail = key(s.steps.slice(1));
    const redundant = seen.some(
      (x) =>
        s.count >= x.count * 0.8 &&
        s.count <= x.count * 1.25 &&
        (key(x.steps.slice(1)) === head || key(x.steps.slice(0, -1)) === tail),
    );
    seen.push(s);
    if (!redundant) kept.push(s);
  }
  return kept;
}

export interface SiteTime {
  domain: string;
  activeMs: number;
  visits: number;
  events: number;
}

export function timePerSite(events: SpoorEvent[]): SiteTime[] {
  const m = new Map<string, SiteTime>();
  for (const e of events) {
    if (!e.domain) continue;
    let s = m.get(e.domain);
    if (!s) m.set(e.domain, (s = { domain: e.domain, activeMs: 0, visits: 0, events: 0 }));
    s.events++;
    if (e.type === 'nav') {
      s.visits++;
      s.activeMs += e.durationMs ?? 0;
    }
  }
  return [...m.values()].sort((a, b) => b.activeMs - a.activeMs || b.events - a.events);
}

export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function timePerDay(
  events: SpoorEvent[],
  from: number,
  to: number,
): { day: string; activeMs: number; events: number }[] {
  const days = new Map<string, { day: string; activeMs: number; events: number }>();
  const start = new Date(from);
  for (
    let d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    d.getTime() <= to;
    d.setDate(d.getDate() + 1)
  ) {
    const k = dayKey(d.getTime());
    days.set(k, { day: k, activeMs: 0, events: 0 });
  }
  for (const e of events) {
    const k = dayKey(e.ts);
    const d = days.get(k);
    if (!d) continue;
    d.events++;
    if (e.type === 'nav') d.activeMs += e.durationMs ?? 0;
  }
  return [...days.values()];
}

export interface AiSummary {
  site: string;
  prompts: number;
  avgChars: number;
}

export function aiSummary(events: SpoorEvent[]): AiSummary[] {
  const m = new Map<string, { prompts: number; chars: number }>();
  for (const e of events) {
    if (e.type !== 'ai_prompt' || !e.ai) continue;
    const s = m.get(e.ai.site) ?? { prompts: 0, chars: 0 };
    s.prompts++;
    s.chars += e.ai.chars;
    m.set(e.ai.site, s);
  }
  return [...m.entries()]
    .map(([site, s]) => ({ site, prompts: s.prompts, avgChars: Math.round(s.chars / s.prompts) }))
    .sort((a, b) => b.prompts - a.prompts);
}

export function countSessions(events: SpoorEvent[]): number {
  return new Set(events.map((e) => e.sessionId)).size;
}

export function formatDuration(ms: number): string {
  if (!ms || ms < 0) return '0m';
  const m = Math.round(ms / 60_000);
  if (m < 1) return `${Math.round(ms / 1000)}s`;
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}

/** Plain text summary for pasting into a Claude conversation (no MCP needed). */
export function summaryForClaude(events: SpoorEvent[], from: number, to: number): string {
  const lines: string[] = [];
  const total = events.filter((e) => e.type === 'nav').reduce((a, e) => a + (e.durationMs ?? 0), 0);
  lines.push(`Spoor browser activity summary, ${dayKey(from)} to ${dayKey(to)}`);
  lines.push(
    `Active time: ${formatDuration(total)} across ${countSessions(events)} sessions and ${events.length} events.`,
  );
  lines.push('');
  lines.push('Top sites by active time:');
  for (const s of timePerSite(events).slice(0, 15)) {
    lines.push(`- ${s.domain}: ${formatDuration(s.activeMs)}, ${s.visits} page views, ${s.events} events`);
  }
  lines.push('');
  lines.push('Time per day:');
  for (const d of timePerDay(events, from, to))
    lines.push(`- ${d.day}: ${formatDuration(d.activeMs)} (${d.events} events)`);
  for (const len of [3, 5]) {
    const seqs = topSequences(events, len, 2, 10);
    lines.push('');
    lines.push(`Most repeated sequences of ${len} steps (activity = site+screen · action "label"):`);
    if (!seqs.length) lines.push('- none repeated yet');
    seqs.forEach((s, i) => {
      lines.push(`${i + 1}. ${s.count}× in ${s.sessions} sessions, avg ${formatDuration(s.avgDurationMs)}:`);
      for (const step of s.steps) lines.push(`     → ${step}`);
    });
  }
  const ai = aiSummary(events);
  lines.push('');
  lines.push('AI usage:');
  if (!ai.length) lines.push('- no prompts recorded');
  for (const a of ai) lines.push(`- ${a.site}: ${a.prompts} prompts, avg ${a.avgChars} characters`);
  lines.push('');
  lines.push(
    'Please name my most repeated workflows in plain language, estimate weekly time for each, and classify each as: automate with an agent, build an integration, fix with a template, or leave alone.',
  );
  return lines.join('\n');
}
