import { ADAPTER_CONFIGS } from '../../adapters';
import {
  aiSummary,
  countSessions,
  dayKey,
  formatDuration,
  summaryForClaude,
  timePerDay,
  timePerSite,
  topSequences,
} from '../../lib/analysis';
import { getEventsInRange } from '../../lib/db';
import { download, toCsv, toJsonl } from '../../lib/exporters';
import { AI_HEALTH_KEY, send, type AiHealthEntry, type StatusResponse } from '../../lib/messages';
import type { StoredEvent } from '../../lib/schema';
import { $, h, pausedLabel, timeAgo, toast } from '../../lib/ui';

const DAY = 86_400_000;
const PALETTE = ['#5146e1', '#e0582b', '#0d8a5c', '#9b8cf5', '#f0a27e', '#2f9fb8', '#c24f8f', '#7c8a3a'];
const OTHER = '#c9c8c2';

let events: StoredEvent[] = [];
let range = { from: 0, to: 0 };

function parseDay(v: string, end: boolean): number {
  const [y, m, d] = v.split('-').map(Number);
  const t = new Date(y, m - 1, d).getTime();
  return end ? t + DAY - 1 : t;
}

function setRange(daysBack: number): void {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysBack);
  ($('#from') as HTMLInputElement).value = dayKey(from.getTime());
  ($('#to') as HTMLInputElement).value = dayKey(today.getTime());
}

async function load(): Promise<void> {
  range = {
    from: parseDay(($('#from') as HTMLInputElement).value, false),
    to: parseDay(($('#to') as HTMLInputElement).value, true),
  };
  events = (await getEventsInRange(range.from, range.to)).sort((a, b) => a.ts - b.ts);
  render();
}

function render(): void {
  const navs = events.filter((e) => e.type === 'nav');
  const active = navs.reduce((a, e) => a + (e.durationMs ?? 0), 0);
  const sites = timePerSite(events);
  $('#stat-active').textContent = formatDuration(active);
  $('#stat-sessions').textContent = String(countSessions(events));
  $('#stat-events').textContent = events.length.toLocaleString();
  $('#stat-sites').textContent = String(sites.length);

  renderPerDay();
  renderTimelineDays();
  renderTopSites(sites);
  renderSequences();
  renderAi();
  renderEvents();
}

function renderPerDay(): void {
  const days = timePerDay(events, range.from, range.to);
  const max = Math.max(1, ...days.map((d) => d.activeMs));
  const root = $('#per-day');
  root.replaceChildren(
    ...days.map((d) => {
      const pct = (d.activeMs / max) * 100;
      return h(
        'div',
        { class: 'col', title: `${d.day}: ${formatDuration(d.activeMs)}, ${d.events} events` },
        h('div', { class: 'muted small', text: d.activeMs ? formatDuration(d.activeMs) : '' }),
        h('div', { class: 'b', style: `height:${pct.toFixed(1)}%` }),
        h('div', { class: 'd', text: d.day.slice(5) }),
      );
    }),
  );
}

function domainColors(): Map<string, string> {
  const m = new Map<string, string>();
  timePerSite(events)
    .slice(0, PALETTE.length)
    .forEach((s, i) => m.set(s.domain, PALETTE[i]));
  return m;
}

function renderTimelineDays(): void {
  const sel = $('#timeline-day') as HTMLSelectElement;
  const days = [...new Set(events.map((e) => dayKey(e.ts)))].sort().reverse();
  const prev = sel.value;
  sel.replaceChildren(...days.map((d) => h('option', { value: d, text: d })));
  if (days.includes(prev)) sel.value = prev;
  renderTimeline();
}

function renderTimeline(): void {
  const day = ($('#timeline-day') as HTMLSelectElement).value;
  const root = $('#timeline');
  const legend = $('#timeline-legend');
  if (!day) {
    root.replaceChildren(h('div', { class: 'empty', text: 'No activity in this range yet.' }));
    legend.replaceChildren();
    return;
  }
  const start = parseDay(day, false);
  const colors = domainColors();
  const navs = events.filter((e) => e.type === 'nav' && e.ts >= start && e.ts < start + DAY);
  // Zoom to the hours with activity.
  const first = Math.min(...navs.map((e) => e.ts), start + 9 * 3_600_000);
  const last = Math.max(...navs.map((e) => e.ts + (e.durationMs ?? 0)), start + 18 * 3_600_000);
  const from = Math.max(start, Math.floor((first - start) / 3_600_000) * 3_600_000 + start);
  const to = Math.min(start + DAY, Math.ceil((last - start) / 3_600_000) * 3_600_000 + start);
  const span = Math.max(1, to - from);
  const bar = h('div', { class: 'timeline' });
  for (const e of navs) {
    const left = ((e.ts - from) / span) * 100;
    const width = (((e.durationMs ?? 0) || 15_000) / span) * 100;
    bar.append(
      h('div', {
        class: 'seg',
        style: `left:${left}%;width:${Math.max(width, 0.15)}%;background:${colors.get(e.domain) ?? OTHER}`,
        title: `${new Date(e.ts).toLocaleTimeString()} · ${e.domain}${e.urlTemplate} · ${formatDuration(e.durationMs ?? 0)}${e.title ? `\n${e.title}` : ''}`,
      }),
    );
  }
  const hours = h('div', { class: 'hours' });
  for (let t = from; t <= to; t += 3_600_000) {
    hours.append(
      h('span', { style: `left:${((t - from) / span) * 100}%`, text: `${new Date(t).getHours()}h` }),
    );
  }
  root.replaceChildren(bar, hours);
  legend.replaceChildren(
    ...[...colors.entries()].map(([d, c]) => h('span', {}, h('i', { style: `background:${c}` }), d)),
    h('span', {}, h('i', { style: `background:${OTHER}` }), 'other'),
  );
}

function renderTopSites(sites: ReturnType<typeof timePerSite>): void {
  const max = Math.max(1, ...sites.map((s) => s.activeMs));
  const t = $('#top-sites');
  if (!sites.length) {
    t.replaceChildren(h('tr', {}, h('td', { class: 'empty', text: 'Nothing recorded yet.' })));
    return;
  }
  t.replaceChildren(
    h(
      'tr',
      {},
      h('th', { text: 'Site' }),
      h('th', { text: '' }),
      h('th', { class: 'num', text: 'Time' }),
      h('th', { class: 'num', text: 'Views' }),
    ),
    ...sites
      .slice(0, 15)
      .map((s) =>
        h(
          'tr',
          {},
          h('td', { text: s.domain }),
          h(
            'td',
            { style: 'width:35%' },
            h('div', { class: 'bar', style: `width:${(s.activeMs / max) * 100}%` }),
          ),
          h('td', { class: 'num', text: formatDuration(s.activeMs) }),
          h('td', { class: 'num', text: String(s.visits) }),
        ),
      ),
  );
}

const SEQ_PREVIEW = 4;
let showAllSequences = false;

function renderSequences(): void {
  const len = Number(($('#seq-length') as HTMLSelectElement).value);
  const seqs = topSequences(events, len, 2, 8);
  const root = $('#sequences');
  if (!seqs.length) {
    root.replaceChildren(
      h('div', {
        class: 'empty',
        text: 'No sequence repeated at least twice yet. Keep recording a few days.',
      }),
    );
    return;
  }
  const shown = showAllSequences ? seqs : seqs.slice(0, SEQ_PREVIEW);
  const hidden = seqs.length - shown.length;
  const grid = h(
    'div',
    { class: 'seq-grid' },
    ...shown.map((s) =>
      h(
        'div',
        { class: 'seq' },
        h(
          'div',
          { class: 'seq-head' },
          h('span', { class: 'seq-count', text: `${s.count}×` }),
          h('span', {
            class: 'muted small',
            text: `${s.sessions} session${s.sessions === 1 ? '' : 's'} · avg ${formatDuration(s.avgDurationMs)}`,
          }),
        ),
        h('ol', {}, ...s.steps.map((st) => h('li', { text: st, title: st }))),
      ),
    ),
  );
  const toggle =
    seqs.length > SEQ_PREVIEW
      ? h('button', { class: 'seq-toggle', text: showAllSequences ? 'Show fewer' : `Show ${hidden} more` })
      : null;
  toggle?.addEventListener('click', () => {
    showAllSequences = !showAllSequences;
    renderSequences();
  });
  root.replaceChildren(grid, ...(toggle ? [toggle] : []));
}

async function renderAiWarnings(): Promise<void> {
  const r = await chrome.storage.local.get(AI_HEALTH_KEY);
  const health = (r[AI_HEALTH_KEY] as Record<string, AiHealthEntry>) ?? {};
  const root = $('#ai-warnings');
  const broken = ADAPTER_CONFIGS.filter((c) => health[c.site] && !health[c.site].healthy);
  root.replaceChildren(
    ...broken.map((c) =>
      h(
        'div',
        { class: 'notice', role: 'alert' },
        h('strong', { text: `The ${c.site} adapter needs an update. ` }),
        `Spoor could not find the prompt box on ${c.matches[0]} (${health[c.site].detail ?? 'selectors not found'}, checked ${timeAgo(health[c.site].checkedAt)}). Prompts there are not recorded; time on the site still is. See CONTRIBUTING.md → “How to fix an adapter”.`,
      ),
    ),
  );
}

function renderAi(): void {
  const summary = aiSummary(events);
  const root = $('#ai-summary');
  const aiDomains: Record<string, string> = {};
  for (const c of ADAPTER_CONFIGS) for (const m of c.matches) aiDomains[m] = c.site;
  const timeBySite = new Map<string, number>();
  for (const e of events) {
    const site = aiDomains[e.domain];
    if (site && e.type === 'nav') timeBySite.set(site, (timeBySite.get(site) ?? 0) + (e.durationMs ?? 0));
  }
  const sites = ADAPTER_CONFIGS.map((c) => c.site).filter(
    (s) => timeBySite.has(s) || summary.some((x) => x.site === s),
  );
  if (!sites.length) {
    root.replaceChildren(
      h('div', { class: 'empty', text: 'No visits to ChatGPT, Claude, Gemini or Copilot in this range.' }),
    );
  } else {
    root.replaceChildren(
      h(
        'table',
        {},
        h(
          'tr',
          {},
          h('th', { text: 'Site' }),
          h('th', { class: 'num', text: 'Prompts' }),
          h('th', { class: 'num', text: 'Avg length' }),
          h('th', { class: 'num', text: 'Time' }),
        ),
        ...sites.map((s) => {
          const x = summary.find((y) => y.site === s);
          return h(
            'tr',
            {},
            h('td', { text: s }),
            h('td', { class: 'num', text: String(x?.prompts ?? 0) }),
            h('td', { class: 'num', text: x ? `${x.avgChars} chars` : '—' }),
            h('td', { class: 'num', text: formatDuration(timeBySite.get(s) ?? 0) }),
          );
        }),
      ),
    );
  }
  const prompts = events
    .filter((e) => e.type === 'ai_prompt')
    .slice(-8)
    .reverse();
  $('#ai-prompts').replaceChildren(
    ...(prompts.length ? [h('h3', { text: 'Latest prompts' })] : []),
    ...prompts.map((p) =>
      h(
        'div',
        { class: 'prompt' },
        h('div', {
          class: 'muted',
          text: `${new Date(p.ts).toLocaleString()} · ${p.ai?.site} · ${p.ai?.chars} chars`,
        }),
        p.ai?.text
          ? p.ai.text.length > 280
            ? p.ai.text.slice(0, 280) + '…'
            : p.ai.text
          : h('em', { class: 'muted', text: 'text not recorded' }),
      ),
    ),
  );
}

function describe(e: StoredEvent): string {
  const parts: string[] = [];
  if (e.element?.label) parts.push(`“${e.element.label}”`);
  else if (e.element?.tag) parts.push(`<${e.element.tag}>`);
  if (e.value)
    parts.push(
      e.value.text
        ? `= ${e.value.text.length > 80 ? e.value.text.slice(0, 80) + '…' : e.value.text}`
        : `(${e.value.chars} chars)`,
    );
  if (e.ai) parts.push(`${e.ai.site}: ${e.ai.text ? e.ai.text.slice(0, 80) : `${e.ai.chars} chars`}`);
  if (e.type === 'nav')
    parts.push(e.title ?? '', e.durationMs ? `· ${formatDuration(e.durationMs)}` : '· open');
  return parts.filter(Boolean).join(' ');
}

function renderEvents(): void {
  const last = events.slice(-100).reverse();
  const t = $('#events');
  if (!last.length) {
    t.replaceChildren(h('tr', {}, h('td', { class: 'empty', text: 'No events in this range.' })));
    return;
  }
  t.replaceChildren(
    h(
      'tr',
      {},
      h('th', { text: 'Time' }),
      h('th', { text: 'Type' }),
      h('th', { text: 'Screen' }),
      h('th', { text: 'Detail' }),
      h('th', { text: '' }),
    ),
    ...last.map((e) =>
      h(
        'tr',
        {},
        h('td', { text: new Date(e.ts).toLocaleTimeString(), title: new Date(e.ts).toLocaleString() }),
        h('td', { text: e.type }),
        h('td', { text: `${e.domain}${e.urlTemplate}` }),
        h('td', { text: describe(e) }),
        h('td', {
          class: 'muted',
          title: e.synced ? 'Stored by the bridge' : 'Waiting for the bridge',
          text: e.synced ? '✓' : '…',
        }),
      ),
    ),
  );
}

async function renderHeader(): Promise<StatusResponse> {
  const st = await send<StatusResponse>({ kind: 'getStatus' });
  $('#rec').className = `pill ${st.recording ? 'rec' : 'off'}`;
  $('#rec-text').textContent = st.recording
    ? 'REC'
    : st.paused
      ? `OFF · ${pausedLabel(st.pausedUntil)}`
      : 'OFF';
  const b = $('#bridge');
  if (st.bridge.state === 'connected') {
    b.className = 'pill ok small';
    b.textContent = `Bridge connected · ${st.counts.unsynced} waiting`;
  } else {
    b.className = 'pill warn small';
    b.textContent = `Bridge not connected · ${st.counts.unsynced} waiting`;
    b.title = st.bridge.lastError ?? '';
  }
  return st;
}

async function syncNow(button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  button.textContent = 'Syncing…';
  try {
    await send({ kind: 'flushBridge' });
    const st = await renderHeader();
    if (st.bridge.state !== 'connected') {
      toast('Bridge not connected. See Settings to set it up.');
    } else if (st.counts.unsynced > 0) {
      toast(`Synced. ${st.counts.unsynced} events still waiting`);
    } else {
      toast('Sync finished. All events stored');
    }
    await load();
  } catch {
    toast('Sync failed');
  } finally {
    button.disabled = false;
    button.textContent = 'Sync';
  }
}

function fileStamp(): string {
  return `${dayKey(range.from)}_${dayKey(range.to)}`;
}

async function main(): Promise<void> {
  setRange(6);
  document.querySelectorAll<HTMLButtonElement>('[data-range]').forEach((b) =>
    b.addEventListener('click', () => {
      setRange(Number(b.dataset.range));
      void load();
    }),
  );
  $('#from').addEventListener('change', () => void load());
  $('#to').addEventListener('change', () => void load());
  $('#timeline-day').addEventListener('change', renderTimeline);
  $('#seq-length').addEventListener('change', renderSequences);
  $('#export-jsonl').addEventListener('click', () => {
    download(`spoor-${fileStamp()}.jsonl`, toJsonl(events), 'application/x-ndjson');
    toast(`Exported ${events.length} events`);
  });
  $('#export-csv').addEventListener('click', () => {
    download(`spoor-${fileStamp()}.csv`, toCsv(events), 'text/csv');
    toast(`Exported ${events.length} events`);
  });
  $('#copy-summary').addEventListener('click', async () => {
    await navigator.clipboard.writeText(summaryForClaude(events, range.from, range.to));
    toast('Summary copied. Paste it into a conversation with Claude.');
  });
  const syncButton = $('#sync-now') as HTMLButtonElement;
  syncButton.addEventListener('click', () => void syncNow(syncButton));
  $('#delete-all').addEventListener('click', async () => {
    if (
      !confirm('Delete every recorded event, in the browser and in the SQLite file? This cannot be undone.')
    )
      return;
    await send({ kind: 'deleteAll' });
    toast('All data deleted');
    await load();
  });
  await Promise.all([load(), renderHeader(), renderAiWarnings()]);
  setInterval(() => void renderHeader(), 10_000);
}

void main();
