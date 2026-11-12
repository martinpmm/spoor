import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { encodeFrame, FrameReader, handleRequest } from '../src/protocol.js';
import { Store } from '../src/store.js';
import { browserTargets, hostManifest } from '../src/register.js';
import { ev, seedDay, T0 } from './seed.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const hostJs = path.join(here, '..', 'dist', 'host.js');

describe('native messaging protocol', () => {
  it('frames and unframes messages split across chunks', () => {
    const got: unknown[] = [];
    const r = new FrameReader((m) => got.push(m));
    const buf = Buffer.concat([encodeFrame({ a: 1 }), encodeFrame({ b: 'ñ' })]);
    for (let i = 0; i < buf.length; i += 3) r.push(buf.subarray(i, i + 3));
    expect(got).toEqual([{ a: 1 }, { b: 'ñ' }]);
  });

  it('handles every request type', () => {
    const s = Store.memory();
    expect(handleRequest(s, 'db', { type: 'hello', reqId: '1' })).toMatchObject({
      type: 'hello',
      reqId: '1',
      events: 0,
    });
    const events = seedDay();
    const ack = handleRequest(s, 'db', { type: 'batch', reqId: '2', events });
    expect(ack).toMatchObject({ type: 'ack', reqId: '2' });
    expect((ack.ids as string[]).length).toBe(events.length);
    expect(
      handleRequest(s, 'db', { type: 'settings', settings: { claudeReadsValues: false } }),
    ).toMatchObject({ type: 'ok' });
    expect(s.getSettings().claudeReadsValues).toBe(false);
    expect(handleRequest(s, 'db', { type: 'prune', before: T0 + 1 })).toMatchObject({ deleted: 1 });
    expect(handleRequest(s, 'db', { type: 'stats' })).toMatchObject({ events: events.length - 1 });
    expect(handleRequest(s, 'db', { type: 'deleteAll' })).toMatchObject({ deleted: events.length - 1 });
    expect(
      handleRequest(s, 'db', { type: 'batch', events: new Array(201).fill(ev({ type: 'nav', ts: 1 })) }),
    ).toMatchObject({
      type: 'error',
    });
    expect(handleRequest(s, 'db', { type: 'what' })).toMatchObject({ type: 'error' });
  });
});

describe('register', () => {
  it('knows the manifest folders for every OS', () => {
    expect(browserTargets('linux', '/home/u', {}).map((t) => t.dir)).toContain(
      '/home/u/.config/google-chrome/NativeMessagingHosts',
    );
    // Chrome on Linux follows XDG_CONFIG_HOME when it is set (GitHub runners set it).
    expect(browserTargets('linux', '/home/u', { XDG_CONFIG_HOME: '/xdg' }).map((t) => t.dir)).toContain(
      '/xdg/google-chrome/NativeMessagingHosts',
    );
    expect(browserTargets('darwin', '/Users/u').map((t) => t.browser)).toEqual(
      expect.arrayContaining(['chrome', 'edge', 'brave', 'chromium']),
    );
    expect(browserTargets('win32', 'C:\\Users\\u').every((t) => t.regKey?.startsWith('HKCU\\'))).toBe(true);
  });

  it('allows only the extension origin', () => {
    const m = hostManifest('/x/spoor-host', ['abc', 'abc']);
    expect(m).toMatchObject({
      name: 'com.spoor.bridge',
      type: 'stdio',
      allowed_origins: ['chrome-extension://abc/'],
    });
  });
});

describe.skipIf(!fs.existsSync(hostJs))('host process (built)', () => {
  it('stores batches sent over stdin and exits when stdin closes', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'spoor-host-'));
    const child = spawn(process.execPath, ['--no-warnings', hostJs], {
      env: { ...process.env, SPOOR_HOME: home },
    });
    const replies: Record<string, unknown>[] = [];
    const reader = new FrameReader((m) => replies.push(m as Record<string, unknown>));
    child.stdout.on('data', (c: Buffer) => reader.push(c));
    const events = seedDay();
    child.stdin.write(encodeFrame({ type: 'hello', reqId: 'h' }));
    child.stdin.write(encodeFrame({ type: 'batch', reqId: 'b', events }));
    child.stdin.end();
    const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
    expect(code).toBe(0);
    expect(replies[0]).toMatchObject({ type: 'hello', reqId: 'h' });
    expect(replies[1]).toMatchObject({ type: 'ack', reqId: 'b' });
    const store = Store.openReadOnly(path.join(home, 'events.db'))!;
    expect(store.count()).toBe(events.length);
    store.close();
  });
});
