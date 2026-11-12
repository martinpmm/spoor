import { ACTIVITY_TYPES, type SpoorEvent } from './types.js';

/**
 * Pure analysis helpers over ordered event lists. They run inside the MCP server.
 * extension/lib/analysis.ts holds the same activity and sequence logic for the dashboard.
 */

export interface Activity {
  key: string;
  sessionId: string;
  start: number;
  end: number;
  domain: string;
}

/** An activity is domain + URL template + event type + element label. */
export function activityKey(e: SpoorEvent): string {
  const label = e.element?.label ? ` "${e.element.label}"` : '';
  const site = e.ai ? ` [${e.ai.site}]` : '';
  return `${e.domain}${e.urlTemplate} · ${e.type}${label}${site}`;
}

export function isActivity(e: SpoorEvent): boolean {
  return ACTIVITY_TYPES.includes(e.type);
}

function eventEnd(e: SpoorEvent): number {
  return e.ts + (e.type === 'nav' && e.durationMs ? e.durationMs : 0);
}

/** Groups events by session (ordered by time) and collapses consecutive identical activities. */
export function activitiesBySession(events: SpoorEvent[]): Map<string, Activity[]> {
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  const out = new Map<string, Activity[]>();
  for (const e of sorted) {
    if (!isActivity(e)) continue;
    const key = activityKey(e);
    let list = out.get(e.sessionId);
    if (!list) out.set(e.sessionId, (list = []));
    const last = list[list.length - 1];
    if (last && last.key === key) {
      last.end = Math.max(last.end, eventEnd(e));
      continue;
    }
    list.push({ key, sessionId: e.sessionId, start: e.ts, end: eventEnd(e), domain: e.domain });
  }
  return out;
}

export interface SequenceStat {
  steps: string[];
  count: number;
  sessions: number;
  avgDurationMs: number;
  totalDurationMs: number;
  firstSeen: number;
  lastSeen: number;
}

/**
 * Most repeated activity sequences of a given length. Occurrences inside one session
 * do not overlap: after a match the scan jumps past it, so "A B A B A B" counts
 * "A B" three times, not five.
 */
export function topSequences(
  events: SpoorEvent[],
  length: number,
  minCount: number,
  limit = 20,
  collapse = true,
): SequenceStat[] {
  const all = countSequences(events, length, minCount);
  return (collapse ? collapseShifted(all) : all).slice(0, limit);
}

/**
 * A workflow of N steps shows up as several windows shifted by one step (A B C D, B C D E…),
 * all with about the same count. Keep the first (most frequent) and drop windows that overlap
 * an earlier one by all but one step with a similar count, so each workflow appears once.
 */
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

function countSequences(events: SpoorEvent[], length: number, minCount: number): SequenceStat[] {
  const bySession = activitiesBySession(events);
  const stats = new Map<
    string,
    { steps: string[]; count: number; sessions: Set<string>; total: number; first: number; last: number }
  >();
  for (const [sessionId, acts] of bySession) {
    const lastEndAt = new Map<string, number>();
    for (let i = 0; i + length <= acts.length; i++) {
      const window = acts.slice(i, i + length);
      const steps = window.map((a) => a.key);
      // Skip windows that are a single activity repeated (noise, not a workflow).
      if (new Set(steps).size === 1 && length > 1) continue;
      const k = steps.join('\u0001');
      const prevEnd = lastEndAt.get(k);
      if (prevEnd !== undefined && i < prevEnd) continue;
      lastEndAt.set(k, i + length);
      const dur = Math.max(0, window[window.length - 1].end - window[0].start);
      let s = stats.get(k);
      if (!s)
        stats.set(
          k,
          (s = { steps, count: 0, sessions: new Set(), total: 0, first: window[0].start, last: 0 }),
        );
      s.count++;
      s.sessions.add(sessionId);
      s.total += dur;
      s.first = Math.min(s.first, window[0].start);
      s.last = Math.max(s.last, window[0].start);
    }
  }
  return [...stats.values()]
    .filter((s) => s.count >= minCount)
    .map((s) => ({
      steps: s.steps,
      count: s.count,
      sessions: s.sessions.size,
      avgDurationMs: Math.round(s.total / s.count),
      totalDurationMs: s.total,
      firstSeen: s.first,
      lastSeen: s.last,
    }))
    .sort((a, b) => b.count - a.count || b.totalDurationMs - a.totalDurationMs);
}

export interface SessionSummary {
  sessionId: string;
  start: number;
  end: number;
  durationMs: number;
  activeMs: number;
  events: number;
  mainSites: { domain: string; activeMs: number; events: number }[];
}

export function summarizeSessions(events: SpoorEvent[]): SessionSummary[] {
  const map = new Map<string, SpoorEvent[]>();
  for (const e of events) {
    let l = map.get(e.sessionId);
    if (!l) map.set(e.sessionId, (l = []));
    l.push(e);
  }
  const out: SessionSummary[] = [];
  for (const [sessionId, list] of map) {
    list.sort((a, b) => a.ts - b.ts);
    const sites = new Map<string, { activeMs: number; events: number }>();
    let activeMs = 0;
    let end = list[0].ts;
    for (const e of list) {
      end = Math.max(end, eventEnd(e));
      if (!e.domain) continue;
      let s = sites.get(e.domain);
      if (!s) sites.set(e.domain, (s = { activeMs: 0, events: 0 }));
      s.events++;
      if (e.type === 'nav' && e.durationMs) {
        s.activeMs += e.durationMs;
        activeMs += e.durationMs;
      }
    }
    out.push({
      sessionId,
      start: list[0].ts,
      end,
      durationMs: end - list[0].ts,
      activeMs,
      events: list.length,
      mainSites: [...sites.entries()]
        .map(([domain, s]) => ({ domain, ...s }))
        .sort((a, b) => b.activeMs - a.activeMs || b.events - a.events)
        .slice(0, 5),
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

export interface SwitchStat {
  from: string;
  to: string;
  switches: number;
  copyPaste: number;
  samples: { copied: string; chars: number; fromScreen: string; toScreen: string }[];
}

/**
 * Most frequent jumps between two sites (consecutive page views in attention order)
 * and copy → paste pairs that cross from one site to another.
 */
export function siteSwitches(events: SpoorEvent[], includeValues: boolean, limit = 20): SwitchStat[] {
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  const stats = new Map<string, SwitchStat>();
  const get = (from: string, to: string) => {
    const k = `${from}\u0001${to}`;
    let s = stats.get(k);
    if (!s) stats.set(k, (s = { from, to, switches: 0, copyPaste: 0, samples: [] }));
    return s;
  };
  const lastNavDomain = new Map<string, string>();
  const lastCopy = new Map<string, SpoorEvent>();
  for (const e of sorted) {
    if (e.type === 'nav' && e.domain) {
      const prev = lastNavDomain.get(e.sessionId);
      if (prev && prev !== e.domain) get(prev, e.domain).switches++;
      lastNavDomain.set(e.sessionId, e.domain);
    } else if (e.type === 'copy') {
      lastCopy.set(e.sessionId, e);
    } else if (e.type === 'paste') {
      const c = lastCopy.get(e.sessionId);
      if (c && c.domain && e.domain && c.domain !== e.domain) {
        const s = get(c.domain, e.domain);
        s.copyPaste++;
        if (s.samples.length < 5) {
          s.samples.push({
            copied: includeValues ? (e.value?.text ?? c.value?.text ?? '') : '',
            chars: e.value?.chars ?? c.value?.chars ?? 0,
            fromScreen: c.urlTemplate,
            toScreen: e.urlTemplate,
          });
        }
      }
    }
  }
  return [...stats.values()]
    .sort((a, b) => b.copyPaste * 5 + b.switches - (a.copyPaste * 5 + a.switches))
    .slice(0, limit);
}

export interface FieldStat {
  urlTemplate: string;
  label: string;
  tag: string;
  kind: string;
  count: number;
  distinctValues: number;
  avgChars: number;
  topValues: { value: string | null; chars: number; count: number }[];
}

/** What gets typed into each field of a screen (change events grouped by field label). */
export function fieldValues(events: SpoorEvent[], includeValues: boolean): FieldStat[] {
  const map = new Map<string, { stat: FieldStat; values: Map<string, { chars: number; count: number }> }>();
  for (const e of events) {
    if ((e.type !== 'change' && e.type !== 'upload') || !e.value) continue;
    const label = e.element?.label ?? '(no label)';
    const k = `${e.urlTemplate}\u0001${label}\u0001${e.element?.tag ?? ''}`;
    let entry = map.get(k);
    if (!entry) {
      entry = {
        stat: {
          urlTemplate: e.urlTemplate,
          label,
          tag: e.element?.tag ?? '',
          kind: e.value.kind,
          count: 0,
          distinctValues: 0,
          avgChars: 0,
          topValues: [],
        },
        values: new Map(),
      };
      map.set(k, entry);
    }
    entry.stat.count++;
    entry.stat.avgChars += e.value.chars;
    const v = entry.values.get(e.value.text);
    if (v) v.count++;
    else entry.values.set(e.value.text, { chars: e.value.chars, count: 1 });
  }
  return [...map.values()]
    .map(({ stat, values }) => ({
      ...stat,
      avgChars: Math.round(stat.avgChars / Math.max(1, stat.count)),
      distinctValues: values.size,
      topValues: [...values.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 10)
        .map(([value, v]) => ({ value: includeValues ? value : null, chars: v.chars, count: v.count })),
    }))
    .sort((a, b) => b.count - a.count);
}

export interface AiUsage {
  totalPrompts: number;
  bySite: { site: string; prompts: number; avgChars: number; totalChars: number }[];
  byHour: { hour: number; prompts: number }[];
  prompts: { ts: number; site: string; chars: number; text: string | null; sessionId: string }[];
  timeOnSitesMs: { site: string; domain: string; activeMs: number }[];
}

const AI_DOMAINS: Record<string, string> = {
  'chatgpt.com': 'chatgpt',
  'chat.openai.com': 'chatgpt',
  'claude.ai': 'claude',
  'gemini.google.com': 'gemini',
  'copilot.microsoft.com': 'copilot',
};

export function aiUsage(events: SpoorEvent[], includeText: boolean, maxPrompts = 200): AiUsage {
  const prompts = events.filter((e) => e.type === 'ai_prompt' && e.ai);
  const bySite = new Map<string, { prompts: number; totalChars: number }>();
  const byHour = new Array(24).fill(0) as number[];
  for (const p of prompts) {
    const s = bySite.get(p.ai!.site) ?? { prompts: 0, totalChars: 0 };
    s.prompts++;
    s.totalChars += p.ai!.chars;
    bySite.set(p.ai!.site, s);
    byHour[new Date(p.ts).getHours()]++;
  }
  const time = new Map<string, { site: string; domain: string; activeMs: number }>();
  for (const e of events) {
    const site = AI_DOMAINS[e.domain];
    if (!site || e.type !== 'nav' || !e.durationMs) continue;
    const t = time.get(e.domain) ?? { site, domain: e.domain, activeMs: 0 };
    t.activeMs += e.durationMs;
    time.set(e.domain, t);
  }
  return {
    totalPrompts: prompts.length,
    bySite: [...bySite.entries()]
      .map(([site, s]) => ({
        site,
        prompts: s.prompts,
        totalChars: s.totalChars,
        avgChars: Math.round(s.totalChars / s.prompts),
      }))
      .sort((a, b) => b.prompts - a.prompts),
    byHour: byHour.map((p, hour) => ({ hour, prompts: p })).filter((h) => h.prompts > 0),
    prompts: prompts.slice(-maxPrompts).map((p) => ({
      ts: p.ts,
      site: p.ai!.site,
      chars: p.ai!.chars,
      text: includeText ? (p.ai!.text ?? null) : null,
      sessionId: p.sessionId,
    })),
    timeOnSitesMs: [...time.values()].sort((a, b) => b.activeMs - a.activeMs),
  };
}

/** Active time per hour of day (local time), from nav durations. */
export function activeHours(
  navs: { ts: number; duration_ms: number }[],
): { hour: number; activeMs: number }[] {
  const hours = new Array(24).fill(0) as number[];
  for (const n of navs) {
    let t = n.ts;
    let left = n.duration_ms;
    while (left > 0) {
      const d = new Date(t);
      const nextHour = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
      const chunk = Math.min(left, nextHour - t);
      hours[d.getHours()] += chunk;
      left -= chunk;
      t += chunk;
    }
  }
  return hours.map((activeMs, hour) => ({ hour, activeMs })).filter((h) => h.activeMs > 0);
}

/** Removes typed values, clipboard text and prompt text, keeping their lengths. */
export function maskEvent(e: SpoorEvent, includeValues: boolean): SpoorEvent & { valuesHidden?: true } {
  if (includeValues) return e;
  const out: SpoorEvent & { valuesHidden?: true } = { ...e };
  let masked = false;
  if (e.value) {
    out.value = { kind: e.value.kind, text: '', chars: e.value.chars };
    masked = true;
  }
  if (e.ai && e.ai.text !== undefined) {
    out.ai = { site: e.ai.site, chars: e.ai.chars };
    masked = true;
  }
  if (masked) out.valuesHidden = true;
  return out;
}

export function formatDuration(ms: number): string {
  if (!ms || ms < 0) return '0s';
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}
