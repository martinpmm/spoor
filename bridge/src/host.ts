#!/usr/bin/env node
/**
 * Spoor native messaging host.
 *
 * Chrome starts this program when the extension calls chrome.runtime.connectNative('com.spoor.bridge').
 * It reads framed JSON from stdin, writes events to ~/.spoor/events.db and answers on stdout.
 * It opens no port and makes no network requests. It exits when Chrome closes stdin.
 *
 * stdout is reserved for protocol frames: never console.log here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { dataDir, dbPath } from './constants.js';
import { encodeFrame, FrameReader, handleRequest } from './protocol.js';
import { Store, ensureDataDir } from './store.js';

const dir = dataDir();
const file = dbPath();

function log(line: string): void {
  try {
    ensureDataDir(dir);
    const logFile = path.join(dir, 'bridge.log');
    try {
      if (fs.statSync(logFile).size > 1_000_000) fs.renameSync(logFile, logFile + '.1');
    } catch {}
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`, { mode: 0o600 });
  } catch {}
}

let store: Store | null = null;
function getStore(): Store {
  if (!store) store = Store.openWritable(file);
  return store;
}

function send(message: unknown): void {
  process.stdout.write(encodeFrame(message));
}

const reader = new FrameReader((msg) => {
  let response: Record<string, unknown>;
  try {
    response = handleRequest(getStore(), file, msg);
  } catch (err) {
    response = { type: 'error', reqId: (msg as { reqId?: string })?.reqId, error: (err as Error).message };
  }
  if (response.type === 'error') log(`error: ${String(response.error)}`);
  send(response);
});

// The browser closed the pipe (port disconnected or browser quit) while we were replying:
// that is a normal shutdown, not a crash.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED') {
    store?.close();
    process.exit(0);
  }
  log(`stdout error: ${err.stack ?? err.message}`);
  store?.close();
  process.exit(1);
});

process.stdin.on('data', (chunk: Buffer) => reader.push(chunk));
process.stdin.on('end', () => {
  store?.close();
  process.exit(0);
});
process.on('uncaughtException', (err) => {
  log(`uncaught: ${err.stack ?? err.message}`);
  store?.close();
  process.exit(1);
});

log(`host started (pid ${process.pid}, db ${file})`);
