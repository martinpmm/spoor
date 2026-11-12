import { BRIDGE_VERSION, SCHEMA_VERSION } from './constants.js';
import type { Store } from './store.js';
import type { BridgeSettings } from './types.js';

/**
 * Chrome native messaging framing: each message is a 32-bit length in native byte order
 * (little endian on every platform Chrome supports) followed by UTF-8 JSON.
 */
export function encodeFrame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

/** Incremental frame decoder: feed it chunks from stdin, it calls `onMessage` per complete frame. */
export class FrameReader {
  private buf: Buffer = Buffer.alloc(0);
  constructor(private readonly onMessage: (msg: unknown) => void) {}

  push(chunk: Buffer): void {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (this.buf.length >= 4) {
      const len = this.buf.readUInt32LE(0);
      if (this.buf.length < 4 + len) break;
      const body = this.buf.subarray(4, 4 + len).toString('utf8');
      this.buf = this.buf.subarray(4 + len);
      let msg: unknown;
      try {
        msg = JSON.parse(body);
      } catch {
        msg = { type: '__invalid__' };
      }
      this.onMessage(msg);
    }
  }
}

export type BridgeRequest =
  | { type: 'hello'; reqId?: string }
  | { type: 'batch'; reqId?: string; events: unknown[] }
  | { type: 'settings'; reqId?: string; settings: Partial<BridgeSettings> }
  | { type: 'prune'; reqId?: string; before: number }
  | { type: 'deleteAll'; reqId?: string }
  | { type: 'stats'; reqId?: string };

export const MAX_BATCH = 200;

/** Handles one request from the extension and returns the response to send back. */
export function handleRequest(store: Store, dbFile: string, raw: unknown): Record<string, unknown> {
  const msg = (raw ?? {}) as BridgeRequest & { reqId?: string };
  const reqId = msg.reqId;
  try {
    switch (msg.type) {
      case 'hello':
        return {
          type: 'hello',
          reqId,
          version: BRIDGE_VERSION,
          schemaVersion: SCHEMA_VERSION,
          dbPath: dbFile,
          events: store.count(),
        };
      case 'batch': {
        if (!Array.isArray(msg.events)) throw new Error('batch.events must be an array');
        if (msg.events.length > MAX_BATCH) throw new Error(`batch larger than ${MAX_BATCH} events`);
        const r = store.insertEvents(msg.events);
        return { type: 'ack', reqId, ids: r.stored, rejected: r.rejected };
      }
      case 'settings': {
        const s = store.setSettings(msg.settings ?? {});
        return { type: 'ok', reqId, settings: s };
      }
      case 'prune': {
        if (typeof msg.before !== 'number') throw new Error('prune.before must be a number');
        return { type: 'ok', reqId, deleted: store.prune(msg.before) };
      }
      case 'deleteAll':
        return { type: 'ok', reqId, deleted: store.deleteAll() };
      case 'stats': {
        const r = store.range();
        return { type: 'stats', reqId, events: store.count(), first: r.first, last: r.last, dbPath: dbFile };
      }
      default:
        throw new Error(`unknown message type ${String((msg as { type?: unknown }).type)}`);
    }
  } catch (err) {
    return { type: 'error', reqId, error: (err as Error).message };
  }
}
