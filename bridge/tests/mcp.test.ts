import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';
import { Store } from '../src/store.js';
import { seedDay, T0 } from './seed.js';

const DAY = 86_400_000;
const range = { from: new Date(T0 - DAY).toISOString(), to: new Date(T0 + 3 * DAY).toISOString() };

async function connect(store: Store | null) {
  const server = createServer(() => store);
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    if (r.isError) return { error: r.content[0].text };
    return JSON.parse(r.content[0].text);
  };
  return { client, call };
}

describe('mcp server', () => {
  let store: Store;
  let tmp: string;
  beforeEach(() => {
    store = Store.memory();
    store.insertEvents([...seedDay(T0, 'day1'), ...seedDay(T0 + DAY, 'day2')]);
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spoor-mcp-'));
    process.env.SPOOR_HOME = tmp;
  });
  afterEach(() => {
    delete process.env.SPOOR_HOME;
  });

  it('lists every tool and the prompt', async () => {
    const { client } = await connect(store);
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(
      [
        'ai_usage',
        'export_jsonl',
        'field_values',
        'get_overview',
        'get_session',
        'list_sessions',
        'search_events',
        'site_switches',
        'top_sequences',
      ].sort(),
    );
    const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
    expect(prompts).toEqual(['find_automation_opportunities']);
    const p = await client.getPrompt({
      name: 'find_automation_opportunities',
      arguments: { from: '2026-11-01' },
    });
    const text = (p.messages[0].content as { text: string }).text;
    expect(text).toContain('get_overview');
    expect(text).toContain('2026-11-01');
  });

  it('get_overview', async () => {
    const { call } = await connect(store);
    const o = await call('get_overview', range);
    expect(o.totals.sessions).toBe(2);
    expect(o.totals.activeMs).toBe(2 * 33 * 60_000);
    expect(o.topSites[0].domain).toBe('bank.example.com');
    expect(o.topScreens[0].urlTemplate).toBe('/transfers/new');
    expect(o.activeHours.length).toBeGreaterThan(0);
    expect(o.eventsByType.nav).toBe(2 * 17);
  });

  it('list_sessions and get_session', async () => {
    const { call } = await connect(store);
    const l = await call('list_sessions', { ...range, domain: 'bank.example.com' });
    expect(l.sessions.map((s: { sessionId: string }) => s.sessionId)).toEqual(['day2', 'day1']);
    const s = await call('get_session', { sessionId: 'day1' });
    expect(s.totalEvents).toBe(seedDay().length);
    const change = s.events.find((e: { type: string }) => e.type === 'change');
    expect(change.value.text).toBe('Invoice payment');
    expect((await call('get_session', { sessionId: 'nope' })).error).toContain('not found');
  });

  it('top_sequences, site_switches, field_values, ai_usage, search_events', async () => {
    const { call } = await connect(store);
    const seq = await call('top_sequences', { ...range, length: 4, minCount: 3 });
    expect(seq.sequences[0].count).toBe(8);
    const sw = await call('site_switches', range);
    expect(
      sw.pairs.find(
        (p: { from: string; to: string }) => p.from === 'erp.example.com' && p.to === 'bank.example.com',
      ).copyPaste,
    ).toBe(8);
    const fv = await call('field_values', {
      ...range,
      domain: 'bank.example.com',
      urlTemplate: '/transfers/new',
    });
    expect(fv.fields[0]).toMatchObject({ label: 'Concept', count: 8 });
    expect(fv.fields[0].topValues[0].value).toBe('Invoice payment');
    const ai = await call('ai_usage', range);
    expect(ai.totalPrompts).toBe(2);
    expect(ai.prompts[0].text).toBe('Summarize this invoice email');
    const se = await call('search_events', { ...range, query: 'Invoice payment' });
    expect(se.count).toBe(8);
  });

  it('honors "Let Claude read typed values" = off in every tool', async () => {
    store.setSettings({ claudeReadsValues: false });
    const { call } = await connect(store);
    const s = await call('get_session', { sessionId: 'day1' });
    for (const e of s.events) {
      if (e.value) expect(e.value.text).toBe('');
      if (e.ai) expect(e.ai.text).toBeUndefined();
    }
    expect(s.events.find((e: { type: string }) => e.type === 'change').value.chars).toBe(15);
    const fv = await call('field_values', { ...range, domain: 'bank.example.com' });
    expect(
      fv.fields.every((f: { topValues: { value: unknown }[] }) => f.topValues.every((v) => v.value === null)),
    ).toBe(true);
    const sw = await call('site_switches', range);
    expect(
      sw.pairs
        .flatMap((p: { samples: { copied: string }[] }) => p.samples)
        .every((x: { copied: string }) => x.copied === ''),
    ).toBe(true);
    const ai = await call('ai_usage', range);
    expect(ai.prompts.every((p: { text: unknown }) => p.text === null)).toBe(true);
    const se = await call('search_events', { ...range, query: 'Invoice payment' });
    expect(se.count).toBe(0);
    const ex = await call('export_jsonl', range);
    expect(fs.readFileSync(ex.path, 'utf8')).not.toContain('Invoice payment');
  });

  it('export_jsonl writes a file', async () => {
    const { call } = await connect(store);
    const ex = await call('export_jsonl', { ...range, path: 'out.jsonl' });
    expect(ex.path).toBe(path.join(tmp, 'exports', 'out.jsonl'));
    const lines = fs.readFileSync(ex.path, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(ex.events);
    expect(JSON.parse(lines[0]).v).toBe(1);
  });

  it('explains what to do when there is no database yet', async () => {
    const { call } = await connect(null);
    expect((await call('get_overview')).error).toContain('No Spoor database');
  });
});
