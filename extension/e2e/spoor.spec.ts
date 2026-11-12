/**
 * End to end: the built extension loaded in Chromium, the fixture app, and the real bridge
 * writing to a temporary SQLite file. Run with `npm run test:e2e` at the repository root.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
// @ts-expect-error plain ESM module without types
import { createServer } from '../../fixtures/invoiceapp/server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const EXT = path.join(root, 'extension', 'dist', 'chrome-mv3');
const REGISTER = path.join(root, 'bridge', 'dist', 'register.js');
const EXT_ID = 'nfdcncheigkogigcjnjpinbmfoibebme';
const PORT = 4399;
const APP = `http://localhost:${PORT}`;
const DOMAIN = `localhost:${PORT}`;

/** Values typed into fields that must never be recorded. */
const SECRETS = [
  'hunter2-password',
  'brand-new-pw-77',
  '4111111111111111',
  'JANE Q CARDHOLDER',
  '12/29',
  '987',
  '4321',
  'firma-xyz-secreta',
  '246810',
  'S3CRET-TOKEN-abc',
  'HIDDEN-CSRF-VALUE',
  'pasted-into-password',
];
/** Secrets that cannot appear by chance inside ids or timestamps, for raw file scans. */
const DISTINCT_SECRETS = SECRETS.filter((s) => /[a-z]/i.test(s) || s.length >= 12);

/** Every human-readable field of the events (values, prompt text, labels, titles). */
function contentDump(events: Ev[]): string {
  return JSON.stringify(
    events.map((e) => [e.value?.text, e.ai?.text, e.element?.label, e.title, e.urlTemplate]),
  );
}

type Ev = {
  id: string;
  ts: number;
  type: string;
  domain: string;
  urlTemplate: string;
  durationMs?: number;
  title?: string;
  element?: { tag: string; label?: string };
  value?: { kind: string; text: string; chars: number };
  ai?: { site: string; chars: number; text?: string };
  synced: number;
};

let ctx: BrowserContext;
let sw: Worker;
let server: ReturnType<typeof createServer>;
let tmp: string;
let userDataDir: string;
let dataDir: string;
let page: Page;

async function idbEvents(): Promise<Ev[]> {
  return sw.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const q = indexedDB.open('spoor');
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
    const all = await new Promise<unknown[]>((res) => {
      const q = db.transaction('events').objectStore('events').getAll();
      q.onsuccess = () => res(q.result);
    });
    db.close();
    return (all as { ts: number }[]).sort((a, b) => a.ts - b.ts) as never;
  });
}

async function sendToBackground<T = unknown>(msg: unknown): Promise<T> {
  const p = await ctx.newPage();
  await p.goto(`chrome-extension://${EXT_ID}/options.html`);
  const r = await p.evaluate((m) => chrome.runtime.sendMessage(m), msg);
  await p.close();
  await page.bringToFront();
  return r as T;
}

/** Everything needed to tell why the bridge did not connect, for the assertion message. */
async function bridgeDiagnostics(): Promise<string> {
  const read = (f: string) => {
    try {
      return fs.readFileSync(f, 'utf8');
    } catch (err) {
      return `<${(err as Error).message}>`;
    }
  };
  const hostsDir = path.join(userDataDir, 'NativeMessagingHosts');
  const manifest = read(path.join(hostsDir, 'com.spoor.bridge.json'));
  let launcher = '';
  try {
    launcher = JSON.parse(manifest).path as string;
  } catch {}
  const status = await sw.evaluate(async () => (await chrome.storage.local.get('bridgeStatus')).bridgeStatus);
  return [
    'Bridge did not connect.',
    `bridgeStatus: ${JSON.stringify(status)}`,
    `manifest (${hostsDir}): ${manifest}`,
    `launcher (${launcher}): ${launcher ? read(launcher) : '<none>'}`,
    `bridge.log: ${read(path.join(dataDir, 'bridge.log'))}`,
    `browser version: ${ctx.browser()?.version() ?? 'unknown (persistent context)'}`,
  ].join('\n');
}

function sqlite(): DatabaseSync | null {
  const file = path.join(dataDir, 'events.db');
  if (!fs.existsSync(file)) return null;
  return new DatabaseSync(file, { readOnly: true });
}

function sqliteRows(): {
  id: string;
  type: string;
  value_text: string | null;
  ai_text: string | null;
  duration_ms: number | null;
}[] {
  const db = sqlite();
  if (!db) return [];
  try {
    return db
      .prepare('SELECT id, type, value_text, ai_text, duration_ms FROM events ORDER BY ts')
      .all() as never;
  } finally {
    db.close();
  }
}

function sqliteMeta(key: string): string | undefined {
  const db = sqlite();
  if (!db) return undefined;
  try {
    return (db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)
      ?.value;
  } finally {
    db.close();
  }
}

/** Everything the bridge wrote to disk, including the WAL, as text. */
function sqliteBytes(): string {
  return fs
    .readdirSync(dataDir)
    .filter((f) => f.startsWith('events.db'))
    .map((f) => fs.readFileSync(path.join(dataDir, f)).toString('latin1'))
    .join('\n');
}

async function settle(ms = 400) {
  await page.waitForTimeout(ms);
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  expect(fs.existsSync(path.join(EXT, 'manifest.json')), 'build the extension first: npm run build').toBe(
    true,
  );
  expect(fs.existsSync(REGISTER), 'build the bridge first: npm run build').toBe(true);
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spoor-e2e-'));
  userDataDir = path.join(tmp, 'profile');
  dataDir = path.join(tmp, 'spoor-home');
  server = createServer();
  await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', () => r()));

  ctx = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    channel: 'chromium',
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  expect(sw.url()).toBe(`chrome-extension://${EXT_ID}/background.js`);

  // The onboarding page opens on install.
  const onboarding =
    ctx.pages().find((p) => p.url().includes('onboarding.html')) ??
    (await ctx.waitForEvent('page', { timeout: 10_000 }));
  await expect(onboarding).toHaveURL(/onboarding\.html/);
  await expect(onboarding.getByText('What is never recorded')).toBeVisible();
  page = await ctx.newPage();
  for (const p of ctx.pages()) if (p !== page) await p.close();
  await page.bringToFront();
});

test.afterAll(async () => {
  await ctx?.close();
  server?.close();
});

test('records the fixture workflow with typed values, and nothing from sensitive fields', async () => {
  // list -> detail -> copy IBAN -> edit form
  await page.goto(`${APP}/invoices`);
  await settle();
  await page.click('a[href="/invoices/1001"]');
  await page.waitForURL('**/invoices/1001');
  await settle();
  await page.evaluate(() => {
    const r = document.createRange();
    r.selectNodeContents(document.getElementById('iban')!);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(r);
    document.execCommand('copy');
  });
  await page.click('#edit');
  await page.waitForURL('**/edit');
  await settle();
  await page.fill('#customer', 'Acme Corporation');
  await page.fill('#amount', '1250.75');
  await page.selectOption('#status', 'Paid');
  await page.check('#paid');
  await page.fill('#notes', 'Paid by transfer, see bank');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/invoices/1001?**');
  await settle();

  // login form with password fields
  await page.goto(`${APP}/login`);
  await settle();
  await page.fill('#username', 'jane');
  await page.fill('#password', 'hunter2-password');
  await page.fill('#newpw', 'brand-new-pw-77');
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'pasted-into-password');
    document
      .getElementById('password')!
      .dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  });
  await page.click('button[type="submit"]');
  await page.waitForURL('**/invoices?**');
  await settle();

  // payment form
  await page.goto(`${APP}/pay`);
  await settle();
  await page.fill('#ref', 'INV-1001');
  await page.fill('#cc', '4111111111111111');
  await page.fill('#ccname', 'JANE Q CARDHOLDER');
  await page.fill('#exp', '12/29');
  await page.fill('#cvv', '987');
  await page.fill('#pin', '4321');
  await page.fill('#clave', 'firma-xyz-secreta');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/invoices?**');
  await settle();

  // one time code
  await page.goto(`${APP}/verify`);
  await settle();
  await page.fill('#otp', '246810');
  await page.fill('#apitoken', 'S3CRET-TOKEN-abc');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/invoices?**');
  await settle();

  // file upload
  await page.goto(`${APP}/upload`);
  await settle();
  await page.setInputFiles('#file', {
    name: 'invoice-1001.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 file body'),
  });
  await settle();

  // single page app
  await page.goto(`${APP}/app/inbox`);
  await settle();
  await page.click('#go-archive');
  await settle();
  await page.click('#go-message');
  await settle(800);

  const events = await idbEvents();
  const compact = events
    .filter((e) => e.domain === DOMAIN)
    .map((e) => [e.type, e.urlTemplate, e.element?.label ?? '', e.value?.text ?? ''].join(' | '));

  expect(compact).toEqual([
    'nav | /invoices |  | ',
    'click | /invoices | 1001 | ',
    'nav | /invoices/{id} |  | ',
    'copy | /invoices/{id} |  | ES91 2100 0418 4502 0005 1332',
    'click | /invoices/{id} | Edit invoice | ',
    'nav | /invoices/{id}/edit |  | ',
    'change | /invoices/{id}/edit | Customer | Acme Corporation',
    // selects fire change at once; text fields when they lose focus
    'change | /invoices/{id}/edit | Status | Paid',
    'change | /invoices/{id}/edit | Amount | 1250.75',
    'change | /invoices/{id}/edit | Mark as paid | on',
    'change | /invoices/{id}/edit | Notes | Paid by transfer, see bank',
    'click | /invoices/{id}/edit | Save invoice | ',
    'submit | /invoices/{id}/edit | Save invoice | ',
    'nav | /invoices/{id} |  | ',
    'nav | /login |  | ',
    'change | /login | User name | jane',
    'click | /login | Sign in | ',
    'submit | /login | Sign in | ',
    'nav | /invoices |  | ',
    'nav | /pay |  | ',
    'change | /pay | Billing reference | INV-1001',
    'click | /pay | Pay now | ',
    'submit | /pay | Pay now | ',
    'nav | /invoices |  | ',
    'nav | /verify |  | ',
    'click | /verify | Verify | ',
    'submit | /verify | Verify | ',
    'nav | /invoices |  | ',
    'nav | /upload |  | ',
    'upload | /upload | Attachment | invoice-1001.pdf',
    'nav | /app/inbox |  | ',
    'click | /app/inbox | Archive | ',
    'nav | /app/archive |  | ',
    'click | /app/archive | Open message | ',
    'nav | /app/message/{uuid} |  | ',
  ]);

  // Durations are written when the user leaves a page; titles are stored.
  const navs = events.filter((e) => e.type === 'nav');
  expect(navs.slice(0, -1).every((e) => typeof e.durationMs === 'number' && e.durationMs > 0)).toBe(true);
  expect(navs[0].title).toBe('Invoices · InvoiceApp');
  // One session for the whole run.
  expect(new Set(events.map((e) => (e as unknown as { sessionId: string }).sessionId)).size).toBe(1);

  const dump = contentDump(events);
  for (const s of SECRETS) expect(dump, `secret "${s}" leaked into IndexedDB`).not.toContain(s);
});

test('bridge: backlog is delivered when the bridge appears, new events arrive within seconds, nothing is lost', async () => {
  // The bridge was not installed during the first test: everything is waiting in IndexedDB.
  const before = await idbEvents();
  expect(before.length).toBeGreaterThan(20);
  expect(before.every((e) => e.synced === 0)).toBe(true);
  expect(sqliteRows()).toHaveLength(0);

  // Install the native host for this profile and reconnect.
  execFileSync(process.execPath, [
    '--no-warnings',
    REGISTER,
    '--target-dir',
    path.join(userDataDir, 'NativeMessagingHosts'),
    '--data-dir',
    dataDir,
  ]);
  // Start a sync and press "Reconnect" right behind it: the reconnect interrupts a connection in
  // progress (the overlap that once made Reconnect wait for the 8 s handshake timeout).
  const p = await ctx.newPage();
  await p.goto(`chrome-extension://${EXT_ID}/options.html`);
  const started = Date.now();
  const r = await p.evaluate(() => {
    void chrome.runtime.sendMessage({ kind: 'flushBridge' });
    return chrome.runtime.sendMessage({ kind: 'reconnectBridge' }) as Promise<{ ok: boolean }>;
  });
  await p.close();
  await page.bringToFront();
  expect(r.ok, await bridgeDiagnostics()).toBe(true);
  expect(Date.now() - started).toBeLessThan(5000);

  await expect
    .poll(async () => (await idbEvents()).filter((e) => e.synced === 0).length, { timeout: 15_000 })
    .toBe(0);
  // Recording continues meanwhile (switching tabs back adds a page view), so wait until both
  // stores hold exactly the same events: every event recorded while the bridge was missing arrived.
  const missingFromSqlite = async () => {
    const sqlIds = new Set(sqliteRows().map((r) => r.id));
    return (await idbEvents()).filter((e) => !sqlIds.has(e.id)).map((e) => e.id);
  };
  await expect.poll(missingFromSqlite, { timeout: 15_000 }).toEqual([]);
  const idbIds = new Set((await idbEvents()).map((e) => e.id));
  expect(sqliteRows().every((r) => idbIds.has(r.id))).toBe(true);
  expect(before.every((e) => idbIds.has(e.id))).toBe(true);
  expect(sqliteMeta('settings')).toContain('"claudeReadsValues":true');

  // Durations patched after the first sync also reach SQLite.
  expect(sqliteRows().filter((r) => r.type === 'nav' && r.duration_ms).length).toBeGreaterThan(10);

  // A new event shows up in SQLite within seconds.
  await page.click('#go-inbox');
  const t0 = Date.now();
  await expect
    .poll(() => sqliteRows().filter((r) => r.type === 'click').length, { timeout: 10_000 })
    .toBe(before.filter((e) => e.type === 'click').length + 1);
  expect(Date.now() - t0).toBeLessThan(10_000);

  // Typed values are in the file, secrets are not (including the WAL).
  const bytes = sqliteBytes();
  expect(bytes).toContain('Acme Corporation');
  for (const s of DISTINCT_SECRETS) expect(bytes, `secret "${s}" leaked into SQLite`).not.toContain(s);
  const columns = JSON.stringify(sqliteRows().map((r) => [r.value_text, r.ai_text]));
  for (const s of SECRETS) expect(columns, `secret "${s}" leaked into SQLite`).not.toContain(s);

  // The file is readable only by the owner.
  if (process.platform !== 'win32')
    expect(fs.statSync(path.join(dataDir, 'events.db')).mode & 0o777).toBe(0o600);
});

test('an excluded site produces no events', async () => {
  await sendToBackground({ kind: 'setSiteRecording', domain: 'localhost', record: false });
  const before = (await idbEvents()).length;
  await page.goto(`${APP}/invoices`);
  await settle();
  await page.click('a[href="/invoices/1002"]');
  await page.waitForURL('**/invoices/1002');
  await page.click('#edit');
  await page.fill('#customer', 'Should not be recorded');
  await page.click('button[type="submit"]');
  await settle(800);
  const after = await idbEvents();
  // Leaving the previous page may close its open page view; no new events are added.
  expect(after.length).toBe(before);
  expect(JSON.stringify(after)).not.toContain('Should not be recorded');
  await sendToBackground({ kind: 'setSiteRecording', domain: 'localhost', record: true });
});

test('AI prompts become ai_prompt events, and a broken adapter shows a warning', async () => {
  test.setTimeout(150_000);
  // Serve fake ChatGPT and Claude pages so the test never touches the real sites.
  await ctx.route('https://chatgpt.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><title>ChatGPT</title><form><div id="prompt-textarea" contenteditable="true" class="ProseMirror"></div><button type="button" data-testid="send-button">Send</button></form>`,
    }),
  );
  await ctx.route('https://claude.ai/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><title>Claude</title><div>a redesigned page without the prompt box</div>`,
    }),
  );
  await page.goto('https://chatgpt.com/c/8c2f1d9e-0b7a-4c55-9a51-2f3e4d5c6b7a');
  await page.click('#prompt-textarea');
  await page.keyboard.type('Draft a polite reminder for invoice 1001');
  await page.keyboard.press('Enter');
  await page.click('button[data-testid="send-button"]'); // same prompt: deduplicated
  await settle(800);
  const prompts = (await idbEvents()).filter((e) => e.type === 'ai_prompt');
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toMatchObject({
    domain: 'chatgpt.com',
    urlTemplate: '/c/{uuid}',
    ai: { site: 'chatgpt', chars: 40, text: 'Draft a polite reminder for invoice 1001' },
  });
  // The prompt box is not also captured as a typed value.
  expect((await idbEvents()).filter((e) => e.domain === 'chatgpt.com' && e.type === 'change')).toHaveLength(
    0,
  );

  // A published artifact has no prompt box by design: no warning, however long the page stays open.
  const health = () =>
    sw.evaluate(
      async () =>
        ((await chrome.storage.local.get('aiHealth')).aiHealth as Record<string, { healthy: boolean }>)
          ?.claude?.healthy,
    );
  await page.goto('https://claude.ai/artifact/E4ZH6yeKM2r8oKe1kxPzL4');
  await settle(23_000);
  expect(await health()).toBeUndefined();

  await page.goto('https://claude.ai/new');
  await expect
    .poll(
      async () =>
        sw.evaluate(
          async () =>
            ((await chrome.storage.local.get('aiHealth')).aiHealth as Record<string, { healthy: boolean }>)
              ?.claude?.healthy,
        ),
      {
        timeout: 40_000,
      },
    )
    .toBe(false);
  const dash = await ctx.newPage();
  await dash.goto(`chrome-extension://${EXT_ID}/dashboard.html`);
  await expect(dash.getByText('The claude adapter needs an update.')).toBeVisible();
  await expect(dash.locator('#ai-summary')).toContainText('chatgpt');
  await dash.close();
  await page.bringToFront();
});

test('events recorded before the rename show up in the dashboard', async () => {
  const dash = await ctx.newPage();
  await dash.goto(`chrome-extension://${EXT_ID}/dashboard.html`);
  // The database of a version from before the rename, left behind in the same profile.
  await dash.evaluate(
    (ts) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('rastro', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('events', { keyPath: 'id' });
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('events', 'readwrite');
          tx.objectStore('events').put({
            v: 1,
            id: 'legacy-event-1',
            ts,
            sessionId: 'legacy-session',
            type: 'nav',
            domain: 'before-the-rename.example',
            urlTemplate: '/',
            durationMs: 60_000,
            synced: 1,
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      }),
    Date.now() - 3_600_000,
  );
  await dash.reload();
  await expect(dash.locator('#top-sites')).toContainText('before-the-rename.example');
  expect((await dash.evaluate(() => indexedDB.databases())).map((d) => d.name)).toEqual(['spoor']);
  // It is sent to the bridge again: the renamed bridge starts with an empty file.
  await sendToBackground({ kind: 'flushBridge' });
  await expect
    .poll(() => sqliteRows().some((r) => r.id === 'legacy-event-1'), { timeout: 15_000 })
    .toBe(true);
  await dash.close();
  await page.bringToFront();
});

test('"Let Claude read typed values" reaches the bridge', async () => {
  const p = await ctx.newPage();
  await p.goto(`chrome-extension://${EXT_ID}/options.html`);
  await expect(p.locator('#bridge-pill')).toHaveText('Bridge connected');
  await p.uncheck('#claudeReadsValues');
  await p.click('#save');
  await expect.poll(() => sqliteMeta('settings'), { timeout: 10_000 }).toContain('"claudeReadsValues":false');
  await p.check('#claudeReadsValues');
  await p.click('#save');
  await expect.poll(() => sqliteMeta('settings'), { timeout: 10_000 }).toContain('"claudeReadsValues":true');
  await p.close();
  await page.bringToFront();
});

test('pause stops recording and the badge shows OFF', async () => {
  await sendToBackground({ kind: 'pause', minutes: 15 });
  await page.goto(`${APP}/invoices`);
  const before = (await idbEvents()).length;
  await page.click('#new-invoice');
  await settle(800);
  expect((await idbEvents()).length).toBe(before);
  expect(await sw.evaluate(() => chrome.action.getBadgeText({}))).toBe('OFF');
  await sendToBackground({ kind: 'resume' });
  await expect.poll(() => sw.evaluate(() => chrome.action.getBadgeText({}))).toBe('REC');
});

test('delete all empties both stores', async () => {
  expect((await idbEvents()).length).toBeGreaterThan(0);
  expect(sqliteRows().length).toBeGreaterThan(0);
  await sendToBackground({ kind: 'deleteAll' });
  await expect.poll(() => sqliteRows().length, { timeout: 10_000 }).toBeLessThanOrEqual(1);
  // At most the page view opened right after deleting (the active tab) remains.
  const left = await idbEvents();
  expect(left.length).toBeLessThanOrEqual(1);
  expect(left.every((e) => e.type === 'nav')).toBe(true);
});
