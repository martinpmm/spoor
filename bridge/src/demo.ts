#!/usr/bin/env node
/**
 * Writes a synthetic week of browser activity to a separate database so you can try the
 * MCP server and the analysis prompt before recording real data.
 *
 *   npm run demo -w bridge                  -> ~/.spoor-demo/events.db
 *   npm run demo -w bridge -- --dir /tmp/x  -> /tmp/x/events.db
 *
 * Ground truth (per working day, Monday to Friday of the previous week):
 *   1. Support ticket triage          helpdesk → set priority and assignee → save        10× ~2 min
 *   2. Invoice payment ERP → bank     copy IBAN in ERP → paste in bank → send           6× ~4 min
 *   3. Lead entry LinkedIn → CRM      copy name/company → new lead form → save           5× ~3 min
 *   4. Expense receipts               upload receipt → amount, category → submit         3× ~2.5 min
 *   5. KPI copy analytics → Sheets    copy numbers → paste in the weekly sheet           2× ~6 min
 * plus prompts to Claude and ChatGPT, mail and news browsing as noise.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import type { SpoorEvent } from './types.js';

type Step = Omit<Partial<SpoorEvent>, 'ts'> &
  Pick<SpoorEvent, 'type' | 'domain' | 'urlTemplate'> & { dt: number };

let seed = 42;
function rand(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
const jitter = (ms: number) => Math.round(ms * (0.75 + rand() * 0.5));
const pick = <T>(a: T[]): T => a[Math.floor(rand() * a.length)];

const S = 1000;
const customers = ['Acme Corp', 'Globex', 'Initech', 'Umbrella', 'Hooli', 'Stark Industries'];
const people = ['Ana García', 'Luis Pérez', 'Marta Ruiz', 'John Smith', 'Sofía López', 'Carlos Díaz'];
const companies = ['Northwind', 'Contoso', 'Fabrikam', 'Tailspin', 'Wingtip'];

function ticketTriage(): Step[] {
  const prio = pick(['High', 'Normal', 'Low']);
  return [
    {
      type: 'nav',
      domain: 'helpdesk.example.com',
      urlTemplate: '/tickets',
      title: 'Open tickets',
      dt: 20 * S,
    },
    {
      type: 'click',
      domain: 'helpdesk.example.com',
      urlTemplate: '/tickets',
      element: { tag: 'a', label: 'View ticket' },
      dt: 2 * S,
    },
    {
      type: 'nav',
      domain: 'helpdesk.example.com',
      urlTemplate: '/tickets/{id}',
      title: 'Ticket',
      dt: 50 * S,
    },
    {
      type: 'change',
      domain: 'helpdesk.example.com',
      urlTemplate: '/tickets/{id}',
      element: { tag: 'select', label: 'Priority' },
      value: { kind: 'select', text: prio, chars: prio.length },
      dt: 15 * S,
    },
    {
      type: 'change',
      domain: 'helpdesk.example.com',
      urlTemplate: '/tickets/{id}',
      element: { tag: 'select', label: 'Assignee' },
      value: { kind: 'select', text: pick(['Level 1', 'Billing', 'Tech']), chars: 7 },
      dt: 15 * S,
    },
    {
      type: 'click',
      domain: 'helpdesk.example.com',
      urlTemplate: '/tickets/{id}',
      element: { tag: 'button', label: 'Save' },
      dt: 20 * S,
    },
  ];
}

function invoicePayment(): Step[] {
  const iban = `ES${Math.floor(rand() * 90 + 10)} 2100 0418 ${Math.floor(rand() * 9000 + 1000)} 0005 1332`;
  const c = pick(customers);
  return [
    { type: 'nav', domain: 'erp.example.com', urlTemplate: '/invoices', title: 'Invoices · ERP', dt: 30 * S },
    {
      type: 'click',
      domain: 'erp.example.com',
      urlTemplate: '/invoices',
      element: { tag: 'a', label: 'Open invoice' },
      dt: 2 * S,
    },
    {
      type: 'nav',
      domain: 'erp.example.com',
      urlTemplate: '/invoices/{id}',
      title: 'Invoice · ERP',
      dt: 40 * S,
    },
    {
      type: 'copy',
      domain: 'erp.example.com',
      urlTemplate: '/invoices/{id}',
      element: { tag: 'span' },
      value: { kind: 'clipboard', text: iban, chars: iban.length },
      dt: 10 * S,
    },
    {
      type: 'nav',
      domain: 'bank.example.com',
      urlTemplate: '/transfers/new',
      title: 'New transfer',
      dt: 20 * S,
    },
    {
      type: 'paste',
      domain: 'bank.example.com',
      urlTemplate: '/transfers/new',
      element: { tag: 'input', label: 'IBAN' },
      value: { kind: 'clipboard', text: iban, chars: iban.length },
      dt: 30 * S,
    },
    {
      type: 'change',
      domain: 'bank.example.com',
      urlTemplate: '/transfers/new',
      element: { tag: 'input', label: 'Beneficiary' },
      value: { kind: 'text', text: c, chars: c.length },
      dt: 30 * S,
    },
    {
      type: 'change',
      domain: 'bank.example.com',
      urlTemplate: '/transfers/new',
      element: { tag: 'input', label: 'Concept' },
      value: { kind: 'text', text: `Invoice ${Math.floor(rand() * 900 + 100)}`, chars: 11 },
      dt: 30 * S,
    },
    {
      type: 'click',
      domain: 'bank.example.com',
      urlTemplate: '/transfers/new',
      element: { tag: 'button', label: 'Send transfer' },
      dt: 30 * S,
    },
  ];
}

function leadEntry(): Step[] {
  const p = pick(people);
  const co = pick(companies);
  return [
    {
      type: 'nav',
      domain: 'linkedin.com',
      urlTemplate: '/in/{token}',
      title: 'Profile · LinkedIn',
      dt: 40 * S,
    },
    {
      type: 'copy',
      domain: 'linkedin.com',
      urlTemplate: '/in/{token}',
      element: { tag: 'h1' },
      value: { kind: 'clipboard', text: p, chars: p.length },
      dt: 10 * S,
    },
    {
      type: 'nav',
      domain: 'crm.example.com',
      urlTemplate: '/leads/new',
      title: 'New lead · CRM',
      dt: 20 * S,
    },
    {
      type: 'paste',
      domain: 'crm.example.com',
      urlTemplate: '/leads/new',
      element: { tag: 'input', label: 'Full name' },
      value: { kind: 'clipboard', text: p, chars: p.length },
      dt: 20 * S,
    },
    {
      type: 'change',
      domain: 'crm.example.com',
      urlTemplate: '/leads/new',
      element: { tag: 'input', label: 'Company' },
      value: { kind: 'text', text: co, chars: co.length },
      dt: 30 * S,
    },
    {
      type: 'change',
      domain: 'crm.example.com',
      urlTemplate: '/leads/new',
      element: { tag: 'select', label: 'Source' },
      value: { kind: 'select', text: 'LinkedIn', chars: 8 },
      dt: 20 * S,
    },
    {
      type: 'click',
      domain: 'crm.example.com',
      urlTemplate: '/leads/new',
      element: { tag: 'button', label: 'Save lead' },
      dt: 40 * S,
    },
  ];
}

function expenses(): Step[] {
  const amount = (rand() * 80 + 5).toFixed(2);
  return [
    {
      type: 'nav',
      domain: 'expenses.example.com',
      urlTemplate: '/reports/{id}',
      title: 'Expense report',
      dt: 30 * S,
    },
    {
      type: 'upload',
      domain: 'expenses.example.com',
      urlTemplate: '/reports/{id}',
      element: { tag: 'input', label: 'Receipt' },
      value: { kind: 'file', text: `receipt-${Math.floor(rand() * 9000)}.jpg`, chars: 16 },
      dt: 30 * S,
    },
    {
      type: 'change',
      domain: 'expenses.example.com',
      urlTemplate: '/reports/{id}',
      element: { tag: 'input', label: 'Amount' },
      value: { kind: 'text', text: amount, chars: amount.length },
      dt: 30 * S,
    },
    {
      type: 'change',
      domain: 'expenses.example.com',
      urlTemplate: '/reports/{id}',
      element: { tag: 'select', label: 'Category' },
      value: { kind: 'select', text: pick(['Meals', 'Taxi', 'Hotel']), chars: 5 },
      dt: 20 * S,
    },
    {
      type: 'submit',
      domain: 'expenses.example.com',
      urlTemplate: '/reports/{id}',
      element: { tag: 'form', label: 'Add expense' },
      dt: 40 * S,
    },
  ];
}

function kpiCopy(): Step[] {
  const n = String(Math.floor(rand() * 9000 + 1000));
  return [
    {
      type: 'nav',
      domain: 'analytics.example.com',
      urlTemplate: '/dashboards/{id}',
      title: 'Weekly KPIs',
      dt: 90 * S,
    },
    {
      type: 'copy',
      domain: 'analytics.example.com',
      urlTemplate: '/dashboards/{id}',
      element: { tag: 'td' },
      value: { kind: 'clipboard', text: n, chars: n.length },
      dt: 30 * S,
    },
    {
      type: 'nav',
      domain: 'docs.google.com',
      urlTemplate: '/spreadsheets/d/{token}/edit',
      title: 'Weekly report - Google Sheets',
      dt: 60 * S,
    },
    {
      type: 'paste',
      domain: 'docs.google.com',
      urlTemplate: '/spreadsheets/d/{token}/edit',
      element: { tag: 'div', label: 'Cell editor' },
      value: { kind: 'clipboard', text: n, chars: n.length },
      dt: 120 * S,
    },
    {
      type: 'nav',
      domain: 'analytics.example.com',
      urlTemplate: '/dashboards/{id}',
      title: 'Weekly KPIs',
      dt: 60 * S,
    },
  ];
}

function aiPrompt(): Step[] {
  const claude = rand() < 0.65;
  const text = claude
    ? pick([
        'Draft a polite reply to a customer asking about a late invoice',
        'Summarize this support ticket in two sentences',
        'Rewrite this email to sound more formal',
      ])
    : pick([
        'Formula to sum a column only if another column says Paid',
        'Translate this paragraph to English',
      ]);
  const domain = claude ? 'claude.ai' : 'chatgpt.com';
  return [
    {
      type: 'nav',
      domain,
      urlTemplate: claude ? '/chat/{uuid}' : '/c/{uuid}',
      title: claude ? 'Claude' : 'ChatGPT',
      dt: 15 * S,
    },
    {
      type: 'ai_prompt',
      domain,
      urlTemplate: claude ? '/chat/{uuid}' : '/c/{uuid}',
      ai: { site: claude ? 'claude' : 'chatgpt', chars: text.length, text },
      dt: 90 * S,
    },
  ];
}

function noise(): Step[] {
  return pick([
    [{ type: 'nav', domain: 'mail.example.com', urlTemplate: '/inbox', title: 'Inbox', dt: 120 * S }],
    [{ type: 'nav', domain: 'news.example.org', urlTemplate: '/', title: 'News', dt: 90 * S }],
    [
      { type: 'nav', domain: 'mail.example.com', urlTemplate: '/inbox', title: 'Inbox', dt: 40 * S },
      {
        type: 'nav',
        domain: 'mail.example.com',
        urlTemplate: '/message/{token}',
        title: 'Message',
        dt: 60 * S,
      },
    ],
  ] as Step[][]);
}

export function generateWeek(monday: Date): SpoorEvent[] {
  const events: SpoorEvent[] = [];
  for (let d = 0; d < 5; d++) {
    const plan: (() => Step[])[] = [
      ...Array(10).fill(ticketTriage),
      ...Array(6).fill(invoicePayment),
      ...Array(5).fill(leadEntry),
      ...Array(3).fill(expenses),
      ...Array(2).fill(kpiCopy),
      ...Array(6).fill(aiPrompt),
      ...Array(8).fill(noise),
    ];
    for (let i = plan.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [plan[i], plan[j]] = [plan[j], plan[i]];
    }
    let t = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + d, 9, 0).getTime();
    let sessionId = crypto.randomUUID();
    let lastNav: SpoorEvent | null = null;
    for (const [k, fn] of plan.entries()) {
      if (k === Math.floor(plan.length / 2)) {
        // lunch break: the open page view ends, idle, then a new session
        if (lastNav) lastNav.durationMs = t - lastNav.ts;
        lastNav = null;
        events.push({
          v: 1,
          id: crypto.randomUUID(),
          ts: t,
          sessionId,
          tabId: 1,
          windowId: 1,
          type: 'idle',
          domain: '',
          urlTemplate: '',
        });
        t += 60 * 60 * S;
        sessionId = crypto.randomUUID();
        events.push({
          v: 1,
          id: crypto.randomUUID(),
          ts: t,
          sessionId,
          tabId: 1,
          windowId: 1,
          type: 'active',
          domain: '',
          urlTemplate: '',
        });
      }
      for (const step of fn()) {
        const { dt, ...rest } = step;
        const e = {
          v: 1,
          id: crypto.randomUUID(),
          ts: t,
          sessionId,
          tabId: 1,
          windowId: 1,
          ...rest,
        } as SpoorEvent;
        if (e.type === 'nav') {
          if (lastNav) lastNav.durationMs = t - lastNav.ts;
          lastNav = e;
        }
        events.push(e);
        t += jitter(dt);
      }
      t += jitter(20 * S);
    }
    if (lastNav) lastNav.durationMs = t - lastNav.ts;
  }
  return events;
}

function main(): void {
  const args = process.argv.slice(2);
  const i = args.indexOf('--dir');
  const dir = i >= 0 ? path.resolve(args[i + 1]) : path.join(os.homedir(), '.spoor-demo');
  const file = path.join(dir, 'events.db');
  for (const f of ['', '-wal', '-shm']) fs.rmSync(file + f, { force: true });
  const now = new Date();
  const lastMonday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - ((now.getDay() + 6) % 7) - 7,
  );
  const events = generateWeek(lastMonday);
  const store = Store.openWritable(file);
  for (let k = 0; k < events.length; k += 200) store.insertEvents(events.slice(k, k + 200));
  store.close();
  const mcpJs = path.join(path.dirname(fileURLToPath(import.meta.url)), 'mcp.js');
  console.log(`Wrote ${events.length} demo events (${lastMonday.toDateString()} to Friday) to ${file}\n`);
  console.log('Add this server to Claude next to (or instead of) the real one:');
  console.log(
    JSON.stringify(
      {
        mcpServers: {
          'spoor-demo': {
            command: process.execPath,
            args: ['--no-warnings', mcpJs],
            env: { SPOOR_HOME: dir },
          },
        },
      },
      null,
      2,
    ),
  );
  console.log(
    '\nThen ask: "Use spoor-demo. What were my five most repeated workflows last week and how long did each take?"',
  );
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
