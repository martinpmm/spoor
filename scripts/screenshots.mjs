// Regenerates docs/screenshots/*.png with demo data. Run after `npm run build`:
//   node scripts/screenshots.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { generateWeek } from '../bridge/dist/demo.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ext = path.join(root, 'extension', 'dist', 'chrome-mv3');
const out = path.join(root, 'docs', 'screenshots');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spoor-shots-'));
const profile = path.join(tmp, 'profile');
fs.mkdirSync(out, { recursive: true });

execFileSync(process.execPath, [
  '--no-warnings',
  path.join(root, 'bridge', 'dist', 'register.js'),
  '--target-dir',
  path.join(profile, 'NativeMessagingHosts'),
  '--data-dir',
  path.join(tmp, 'home'),
]);

const ctx = await chromium.launchPersistentContext(profile, {
  headless: true,
  channel: 'chromium',
  deviceScaleFactor: 2,
  colorScheme: 'light',
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
const id = new URL(sw.url()).host;
await new Promise((r) => setTimeout(r, 1500));

const now = new Date();
const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
const events = generateWeek(monday);
await sw.evaluate(async (evs) => {
  const db = await new Promise((res, rej) => {
    const q = indexedDB.open('spoor');
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
  await new Promise((res, rej) => {
    const tx = db.transaction('events', 'readwrite');
    for (const e of evs) tx.objectStore('events').put({ ...e, synced: 0 });
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
  await chrome.storage.local.set({
    aiHealth: {
      claude: { healthy: true, checkedAt: Date.now() },
      chatgpt: { healthy: true, checkedAt: Date.now() },
    },
  });
}, events);
await sw.evaluate(() => chrome.runtime.sendMessage({ kind: 'flushBridge' }).catch(() => {}));

const shot = async (name, url, viewport, fullPage = true) => {
  const p = await ctx.newPage();
  await p.setViewportSize(viewport);
  await p.goto(url);
  if (name === 'options') {
    await p.evaluate(() => chrome.runtime.sendMessage({ kind: 'flushBridge' }));
  }
  await p.waitForTimeout(1500);
  await p.screenshot({ path: path.join(out, `${name}.png`), fullPage });
  await p.close();
};
await shot('dashboard', `chrome-extension://${id}/dashboard.html`, { width: 1200, height: 900 });
await shot('popup', `chrome-extension://${id}/popup.html`, { width: 340, height: 430 }, false);
await shot('options', `chrome-extension://${id}/options.html`, { width: 900, height: 900 }, false);
await shot('onboarding', `chrome-extension://${id}/onboarding.html`, { width: 900, height: 900 }, false);
await ctx.close();
console.log(`screenshots in ${out}`);
