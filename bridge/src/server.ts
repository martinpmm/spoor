import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  activeHours,
  aiUsage,
  fieldValues,
  formatDuration,
  maskEvent,
  siteSwitches,
  summarizeSessions,
  topSequences,
} from './analysis.js';
import { BRIDGE_VERSION, dataDir } from './constants.js';
import type { Store } from './store.js';
import { iso, resolveRange } from './time.js';
import { ACTIVITY_TYPES, type SpoorEvent } from './types.js';

/**
 * The Spoor MCP server. Every tool is read only: the database is opened in read only mode.
 * The one exception is export_jsonl, which writes a file the user asked for.
 *
 * The "Let Claude read typed values" setting (meta table, pushed by the extension) is honored
 * by every tool: when it is off, typed values, clipboard text and prompt text are replaced by lengths.
 */

const timeArg = z
  .union([z.string(), z.number()])
  .optional()
  .describe(
    'YYYY-MM-DD, ISO 8601, epoch ms, "today", "yesterday" or relative like "7d". Default: 7 days ago / now.',
  );

type StoreGetter = () => Store | null;

const NO_DATA =
  'No Spoor database found yet. Install the extension, run `npm run register` in the bridge package and browse for a while. ' +
  'The options page of the extension shows "Bridge connected" once the first batch is stored.';

function json(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

function eventOut(e: SpoorEvent & { valuesHidden?: true }) {
  return { time: iso(e.ts), ...e };
}

export function createServer(getStore: StoreGetter): McpServer {
  const server = new McpServer(
    { name: 'spoor', version: BRIDGE_VERSION },
    {
      instructions:
        'Spoor is a local browser activity log (sites, steps, typed values, time, AI usage) recorded by the user on their own machine. ' +
        'Use it to discover repeated workflows and automation opportunities. Start with get_overview and top_sequences. ' +
        'Activities are "domain + URL template · event type + element label". URL templates replace ids with {id}, {uuid}, {token}, {email}. ' +
        'When typed values are hidden by the user setting, values come back empty with only their length (valuesHidden: true).',
    },
  );

  const withStore = <A>(fn: (store: Store, args: A) => unknown) => {
    return async (args: A) => {
      const store = getStore();
      if (!store) return fail(NO_DATA);
      try {
        return json(fn(store, args));
      } catch (err) {
        return fail(`Error: ${(err as Error).message}`);
      }
    };
  };

  const readOnly = { readOnlyHint: true, openWorldHint: false } as const;

  server.registerTool(
    'get_overview',
    {
      title: 'Overview',
      description:
        'Totals for a time range: active time (time on pages while the browser had focus), top sites and screens by time, active hours, event counts by type and number of sessions.',
      inputSchema: { from: timeArg, to: timeArg },
      annotations: readOnly,
    },
    withStore<{ from?: string | number; to?: string | number }>((store, args) => {
      const r = resolveRange(args.from, args.to);
      const o = store.overview(r.from, r.to);
      const settings = store.getSettings();
      const all = store.range();
      return {
        range: { from: iso(r.from), to: iso(r.to) },
        dataAvailable: { first: iso(all.first), last: iso(all.last), totalEvents: store.count() },
        typedValuesReadable: settings.claudeReadsValues,
        totals: {
          events: o.totals.events,
          sessions: o.totals.sessions,
          activeMs: o.totals.active_ms,
          active: formatDuration(o.totals.active_ms),
          firstEvent: iso(o.totals.first_ts),
          lastEvent: iso(o.totals.last_ts),
        },
        topSites: o.topSites.map((s) => ({
          domain: s.domain,
          activeMs: s.active_ms,
          active: formatDuration(s.active_ms),
          visits: s.visits,
          events: s.events,
        })),
        topScreens: o.topScreens.map((s) => ({
          domain: s.domain,
          urlTemplate: s.url_template,
          active: formatDuration(s.active_ms),
          activeMs: s.active_ms,
          visits: s.visits,
          fieldChanges: s.field_changes,
        })),
        activeHours: activeHours(o.navs).map((h) => ({
          hour: h.hour,
          active: formatDuration(h.activeMs),
          activeMs: h.activeMs,
        })),
        eventsByType: Object.fromEntries(o.byType.map((t) => [t.type, t.count])),
      };
    }),
  );

  server.registerTool(
    'list_sessions',
    {
      title: 'List sessions',
      description:
        'Browsing sessions (a new session starts after 5 minutes idle or a browser restart) with start, duration, active time and main sites.',
      inputSchema: {
        from: timeArg,
        to: timeArg,
        domain: z
          .string()
          .optional()
          .describe('Only sessions that include this domain (subdomains match too).'),
        limit: z.number().int().min(1).max(1000).optional().describe('Default 100, most recent first.'),
      },
      annotations: readOnly,
    },
    withStore<{ from?: string | number; to?: string | number; domain?: string; limit?: number }>(
      (store, args) => {
        const r = resolveRange(args.from, args.to);
        let events = store.events({ from: r.from, to: r.to });
        if (args.domain) {
          const d = args.domain.toLowerCase();
          const ids = new Set(
            events.filter((e) => e.domain === d || e.domain.endsWith('.' + d)).map((e) => e.sessionId),
          );
          events = events.filter((e) => ids.has(e.sessionId));
        }
        const sessions = summarizeSessions(events)
          .reverse()
          .slice(0, args.limit ?? 100);
        return {
          range: { from: iso(r.from), to: iso(r.to) },
          count: sessions.length,
          sessions: sessions.map((s) => ({
            sessionId: s.sessionId,
            start: iso(s.start),
            end: iso(s.end),
            duration: formatDuration(s.durationMs),
            active: formatDuration(s.activeMs),
            activeMs: s.activeMs,
            events: s.events,
            mainSites: s.mainSites.map((m) => ({
              domain: m.domain,
              active: formatDuration(m.activeMs),
              events: m.events,
            })),
          })),
        };
      },
    ),
  );

  server.registerTool(
    'get_session',
    {
      title: 'Get session',
      description: 'Ordered events of one session, including typed values (unless the user turned that off).',
      inputSchema: {
        sessionId: z.string(),
        offset: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(2000).optional().describe('Default 500.'),
      },
      annotations: readOnly,
    },
    withStore<{ sessionId: string; offset?: number; limit?: number }>((store, args) => {
      const include = store.getSettings().claudeReadsValues;
      const all = store.sessionEvents(args.sessionId);
      if (!all.length) throw new Error(`Session ${args.sessionId} not found.`);
      const offset = args.offset ?? 0;
      const limit = args.limit ?? 500;
      return {
        sessionId: args.sessionId,
        totalEvents: all.length,
        offset,
        returned: Math.min(limit, Math.max(0, all.length - offset)),
        typedValuesReadable: include,
        events: all.slice(offset, offset + limit).map((e) => eventOut(maskEvent(e, include))),
      };
    }),
  );

  server.registerTool(
    'top_sequences',
    {
      title: 'Top repeated sequences',
      description:
        'Most repeated sequences of activities (domain + URL template + event type + element label), with how often they occur and their average duration. These are candidate workflows.',
      inputSchema: {
        from: timeArg,
        to: timeArg,
        length: z
          .number()
          .int()
          .min(2)
          .max(20)
          .optional()
          .describe('Steps per sequence. Default 4. Try 3 to 8.'),
        minCount: z.number().int().min(2).optional().describe('Minimum repetitions. Default 3.'),
        limit: z.number().int().min(1).max(100).optional().describe('Default 20.'),
        domain: z.string().optional().describe('Only events on this domain.'),
        collapse: z
          .boolean()
          .optional()
          .describe('Merge windows of the same workflow shifted by one step. Default true.'),
      },
      annotations: readOnly,
    },
    withStore<{
      from?: string | number;
      to?: string | number;
      length?: number;
      minCount?: number;
      limit?: number;
      domain?: string;
      collapse?: boolean;
    }>((store, args) => {
      const r = resolveRange(args.from, args.to);
      const events = store.events({ from: r.from, to: r.to, types: ACTIVITY_TYPES, domain: args.domain });
      const seqs = topSequences(
        events,
        args.length ?? 4,
        args.minCount ?? 3,
        args.limit ?? 20,
        args.collapse ?? true,
      );
      return {
        range: { from: iso(r.from), to: iso(r.to) },
        length: args.length ?? 4,
        sequences: seqs.map((s) => ({
          count: s.count,
          sessions: s.sessions,
          avgDuration: formatDuration(s.avgDurationMs),
          avgDurationMs: s.avgDurationMs,
          totalDuration: formatDuration(s.totalDurationMs),
          firstSeen: iso(s.firstSeen),
          lastSeen: iso(s.lastSeen),
          steps: s.steps,
        })),
      };
    }),
  );

  server.registerTool(
    'site_switches',
    {
      title: 'Site switches',
      description:
        'Most frequent jumps between two sites, with copy → paste counts across them and samples of what moved. Reveals manual data transfer between systems.',
      inputSchema: { from: timeArg, to: timeArg, limit: z.number().int().min(1).max(100).optional() },
      annotations: readOnly,
    },
    withStore<{ from?: string | number; to?: string | number; limit?: number }>((store, args) => {
      const include = store.getSettings().claudeReadsValues;
      const r = resolveRange(args.from, args.to);
      const events = store.events({ from: r.from, to: r.to, types: ['nav', 'copy', 'paste'] });
      return {
        range: { from: iso(r.from), to: iso(r.to) },
        typedValuesReadable: include,
        pairs: siteSwitches(events, include, args.limit ?? 20),
      };
    }),
  );

  server.registerTool(
    'field_values',
    {
      title: 'Field values',
      description:
        'What gets typed into each field of a screen: count, distinct values and the most common values. Spots repeated manual data entry. Get domain and urlTemplate from get_overview.topScreens.',
      inputSchema: {
        from: timeArg,
        to: timeArg,
        domain: z.string(),
        urlTemplate: z
          .string()
          .optional()
          .describe('For example "/invoices/{id}/edit". Omit for every screen of the domain.'),
      },
      annotations: readOnly,
    },
    withStore<{ from?: string | number; to?: string | number; domain: string; urlTemplate?: string }>(
      (store, args) => {
        const include = store.getSettings().claudeReadsValues;
        const r = resolveRange(args.from, args.to);
        const events = store.events({
          from: r.from,
          to: r.to,
          domain: args.domain.toLowerCase(),
          urlTemplate: args.urlTemplate,
          types: ['change', 'upload'],
        });
        return {
          range: { from: iso(r.from), to: iso(r.to) },
          domain: args.domain,
          urlTemplate: args.urlTemplate ?? null,
          typedValuesReadable: include,
          fields: fieldValues(events, include),
        };
      },
    ),
  );

  server.registerTool(
    'ai_usage',
    {
      title: 'AI usage',
      description:
        'Prompts sent to ChatGPT, Claude, Gemini and Copilot: by site, by hour, length and prompt text; plus time on those sites.',
      inputSchema: {
        from: timeArg,
        to: timeArg,
        maxPrompts: z
          .number()
          .int()
          .min(0)
          .max(1000)
          .optional()
          .describe('Most recent prompts to include. Default 100.'),
      },
      annotations: readOnly,
    },
    withStore<{ from?: string | number; to?: string | number; maxPrompts?: number }>((store, args) => {
      const include = store.getSettings().claudeReadsValues;
      const r = resolveRange(args.from, args.to);
      const events = store.events({ from: r.from, to: r.to, types: ['ai_prompt', 'nav'] });
      const u = aiUsage(events, include, args.maxPrompts ?? 100);
      return {
        range: { from: iso(r.from), to: iso(r.to) },
        typedValuesReadable: include,
        totalPrompts: u.totalPrompts,
        bySite: u.bySite,
        byHour: u.byHour,
        timeOnSites: u.timeOnSitesMs.map((t) => ({ ...t, active: formatDuration(t.activeMs) })),
        prompts: u.prompts.map((p) => ({ ...p, time: iso(p.ts) })),
      };
    }),
  );

  server.registerTool(
    'search_events',
    {
      title: 'Search events',
      description:
        'Text search over domains, URL templates, page titles, element labels and (if allowed) typed values and prompt text.',
      inputSchema: {
        query: z.string().min(1),
        from: timeArg,
        to: timeArg,
        limit: z.number().int().min(1).max(500).optional().describe('Default 50, newest first.'),
      },
      annotations: readOnly,
    },
    withStore<{ query: string; from?: string | number; to?: string | number; limit?: number }>(
      (store, args) => {
        const include = store.getSettings().claudeReadsValues;
        const r = resolveRange(args.from, args.to, 30);
        const found = store.search(args.query, r.from, r.to, include, args.limit ?? 50);
        return {
          range: { from: iso(r.from), to: iso(r.to) },
          query: args.query,
          typedValuesReadable: include,
          count: found.length,
          events: found.map((e) => eventOut(maskEvent(e, include))),
        };
      },
    ),
  );

  server.registerTool(
    'export_jsonl',
    {
      title: 'Export JSONL',
      description:
        'Writes the events of a range to a JSONL file on this machine (one event per line) for other tools such as analysis/process_map.py. Returns the path. Nothing is sent anywhere.',
      inputSchema: {
        from: timeArg,
        to: timeArg,
        path: z
          .string()
          .optional()
          .describe(
            'Output file. Default ~/.spoor/exports/spoor-<from>-<to>.jsonl. Relative paths go under ~/.spoor/exports.',
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    withStore<{ from?: string | number; to?: string | number; path?: string }>((store, args) => {
      const include = store.getSettings().claudeReadsValues;
      const r = resolveRange(args.from, args.to);
      const exportsDir = path.join(dataDir(), 'exports');
      let out = args.path?.trim();
      if (out?.startsWith('~')) out = path.join(os.homedir(), out.slice(1));
      if (!out) out = path.join(exportsDir, `spoor-${fileStamp(r.from)}-${fileStamp(r.to)}.jsonl`);
      else if (!path.isAbsolute(out)) out = path.join(exportsDir, out);
      fs.mkdirSync(path.dirname(out), { recursive: true, mode: 0o700 });
      const events = store.events({ from: r.from, to: r.to });
      const fd = fs.openSync(out, 'w', 0o600);
      try {
        for (const e of events) fs.writeSync(fd, JSON.stringify(maskEvent(e, include)) + '\n');
      } finally {
        fs.closeSync(fd);
      }
      return {
        path: out,
        events: events.length,
        range: { from: iso(r.from), to: iso(r.to) },
        typedValuesIncluded: include,
      };
    }),
  );

  server.registerPrompt(
    'find_automation_opportunities',
    {
      title: 'Find automation opportunities',
      description:
        'Analyze the Spoor log and return a ranked table of workflows worth automating, with evidence.',
      argsSchema: {
        from: z.string().optional().describe('Start of the range, for example 7d or 2026-11-03. Default 7d.'),
        to: z.string().optional().describe('End of the range. Default now.'),
      },
    },
    (args) => {
      const from = args.from || '7d';
      const to = args.to || 'now';
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: findAutomationPrompt(from, to),
            },
          },
        ],
      };
    },
  );

  return server;
}

function fileStamp(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export function findAutomationPrompt(from: string, to: string): string {
  return `Use the Spoor tools to find automation opportunities in my browser work between ${from} and ${to}.

1. Call get_overview and top_sequences for the range (try length 3, 4 and 6 with minCount 3) to see where the time goes and what repeats.
2. Name each repeated sequence as a workflow in plain language (for example "Copy invoice data from the ERP into the bank portal"). Merge sequences that are clearly parts of the same workflow. Use get_session on one or two example sessions when a sequence is unclear.
3. Use field_values on the busiest screens and site_switches for the range to find data that I type or paste by hand between systems.
4. Estimate the weekly time per workflow: repetitions per week × average duration. Say how you estimated it.
5. Classify each workflow as one of: "automate with an agent", "build an integration", "fix with a template" or "leave alone", and give the reason in one sentence.
6. Return a table ranked by estimated weekly time saved, with columns: rank, workflow, systems involved, repetitions per week, average duration, estimated weekly time, classification, evidence (the sequence steps, screens or fields you relied on).

Finish with the one workflow you would automate first and why. If the data is too thin to be confident, say what is missing.`;
}
