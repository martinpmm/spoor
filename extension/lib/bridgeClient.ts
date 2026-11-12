import { BATCH_SIZE, HOST_NAME } from './constants';
import { countUnsynced, getUnsynced, markSynced } from './db';
import { stripStored } from './schema';

/**
 * Client for the native messaging bridge.
 *
 * - Opens a long lived port with chrome.runtime.connectNative.
 * - Sends unsynced events in batches of at most 200; the host answers with the ids it stored
 *   and those are marked synced. Nothing is lost while the bridge is missing: events stay in
 *   IndexedDB with synced = 0 and are sent when the bridge comes back.
 * - Commands (settings, prune, deleteAll) are queued in chrome.storage.local so they survive
 *   a stopped worker and are delivered before the next batch.
 */

export type BridgeState = 'connected' | 'connecting' | 'disconnected';

export interface BridgeStatus {
  state: BridgeState;
  lastError?: string;
  lastAckTs?: number;
  lastConnectTs?: number;
  hostVersion?: string;
  dbPath?: string;
  dbEvents?: number;
  pending?: number;
  updatedAt: number;
}

export type BridgeCommand =
  | { type: 'settings'; settings: { claudeReadsValues: boolean; retentionDays: number } }
  | { type: 'prune'; before: number }
  | { type: 'deleteAll' };

type Pending = {
  resolve: (m: Record<string, unknown>) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const STATUS_KEY = 'bridgeStatus';
const QUEUE_KEY = 'bridgeQueue';
const REQUEST_TIMEOUT_MS = 20_000;

export async function getBridgeStatus(): Promise<BridgeStatus> {
  const r = await chrome.storage.local.get(STATUS_KEY);
  return (r[STATUS_KEY] as BridgeStatus) ?? { state: 'disconnected', updatedAt: 0 };
}

export class BridgeClient {
  private port: chrome.runtime.Port | null = null;
  private pending = new Map<string, Pending>();
  private connecting: Promise<boolean> | null = null;
  private flushing: Promise<void> | null = null;
  private flushAgain = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private generation = 0;

  constructor(
    private readonly connectNative: (host: string) => chrome.runtime.Port = (h) =>
      chrome.runtime.connectNative(h),
  ) {}

  get connected(): boolean {
    return this.port !== null;
  }

  private async setStatus(patch: Partial<BridgeStatus>): Promise<void> {
    const cur = await getBridgeStatus();
    await chrome.storage.local.set({ [STATUS_KEY]: { ...cur, ...patch, updatedAt: Date.now() } });
  }

  /** Opens the port if needed and checks the host answers. */
  ensureConnected(): Promise<boolean> {
    if (this.port) return Promise.resolve(true);
    if (this.connecting) return this.connecting;
    // Each attempt has a generation. disconnect() bumps it, so an attempt it interrupted can
    // neither keep blocking new ones nor overwrite the port or status of a newer connection.
    const gen = ++this.generation;
    const current = () => gen === this.generation;
    const attempt: Promise<boolean> = (async () => {
      await this.setStatus({ state: 'connecting' });
      let port: chrome.runtime.Port;
      try {
        port = this.connectNative(HOST_NAME);
      } catch (err) {
        if (current()) await this.setStatus({ state: 'disconnected', lastError: (err as Error).message });
        return false;
      }
      if (!current()) {
        try {
          port.disconnect();
        } catch {}
        return false;
      }
      this.port = port;
      port.onMessage.addListener((m: Record<string, unknown>) => this.onMessage(m));
      port.onDisconnect.addListener(() => {
        const err = chrome.runtime.lastError?.message ?? 'Bridge disconnected';
        if (this.port !== port) return;
        this.port = null;
        this.rejectPending(err);
        void this.setStatus({ state: 'disconnected', lastError: err });
      });
      try {
        const hello = await this.request({ type: 'hello' }, 8000);
        if (!current()) return false;
        await this.setStatus({
          state: 'connected',
          lastError: undefined,
          lastConnectTs: Date.now(),
          hostVersion: hello.version as string,
          dbPath: hello.dbPath as string,
          dbEvents: hello.events as number,
        });
        return true;
      } catch (err) {
        if (!current()) return false;
        try {
          port.disconnect();
        } catch {}
        if (this.port === port) this.port = null;
        await this.setStatus({ state: 'disconnected', lastError: (err as Error).message });
        return false;
      }
    })().finally(() => {
      if (this.connecting === attempt) this.connecting = null;
    });
    this.connecting = attempt;
    return attempt;
  }

  /**
   * Closes the port. Chrome does not fire onDisconnect for a disconnect we make ourselves,
   * so pending requests (including an in-flight hello) are failed here instead of waiting
   * for their timeout, and a connection attempt in progress is abandoned.
   */
  disconnect(): void {
    this.generation++;
    this.connecting = null;
    const port = this.port;
    this.port = null;
    try {
      port?.disconnect();
    } catch {}
    this.rejectPending('Bridge disconnected');
  }

  private rejectPending(reason: string): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    this.pending.clear();
  }

  private onMessage(m: Record<string, unknown>): void {
    const id = m.reqId as string | undefined;
    if (!id) return;
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    clearTimeout(p.timer);
    if (m.type === 'error') p.reject(new Error(String(m.error)));
    else p.resolve(m);
  }

  private request(
    msg: Record<string, unknown>,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<Record<string, unknown>> {
    const port = this.port;
    if (!port) return Promise.reject(new Error('Bridge not connected'));
    const reqId = `${Date.now().toString(36)}-${++this.seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error('Bridge did not answer in time'));
      }, timeoutMs);
      this.pending.set(reqId, { resolve, reject, timer });
      try {
        port.postMessage({ ...msg, reqId });
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(reqId);
        reject(err as Error);
      }
    });
  }

  /** Queues a command for the bridge; it is delivered (in order) before the next batch. */
  async queueCommand(cmd: BridgeCommand): Promise<void> {
    const r = await chrome.storage.local.get(QUEUE_KEY);
    let q = (r[QUEUE_KEY] as BridgeCommand[]) ?? [];
    if (cmd.type === 'settings') q = q.filter((c) => c.type !== 'settings');
    if (cmd.type === 'deleteAll') q = q.filter((c) => c.type !== 'prune' && c.type !== 'deleteAll');
    q.push(cmd);
    await chrome.storage.local.set({ [QUEUE_KEY]: q });
    this.scheduleFlush(0);
  }

  scheduleFlush(delayMs = 1500): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delayMs);
  }

  /** Sends queued commands, then every unsynced event. Safe to call often. */
  flush(): Promise<void> {
    if (this.flushing) {
      this.flushAgain = true;
      return this.flushing;
    }
    this.flushing = (async () => {
      do {
        this.flushAgain = false;
        await this.flushOnce();
      } while (this.flushAgain);
    })()
      .catch(async (err) => {
        await this.setStatus({ lastError: (err as Error).message });
      })
      .finally(() => {
        this.flushing = null;
      });
    return this.flushing;
  }

  private async flushOnce(): Promise<void> {
    if (!(await this.ensureConnected())) {
      await this.setStatus({ pending: await countUnsynced() });
      return;
    }
    // 1. commands
    for (;;) {
      const r = await chrome.storage.local.get(QUEUE_KEY);
      const q = (r[QUEUE_KEY] as BridgeCommand[]) ?? [];
      if (!q.length) break;
      await this.request(q[0] as unknown as Record<string, unknown>);
      const r2 = await chrome.storage.local.get(QUEUE_KEY);
      const q2 = ((r2[QUEUE_KEY] as BridgeCommand[]) ?? []).slice(1);
      await chrome.storage.local.set({ [QUEUE_KEY]: q2 });
    }
    // 2. events
    for (;;) {
      const batch = await getUnsynced(BATCH_SIZE);
      if (!batch.length) break;
      const ack = await this.request({ type: 'batch', events: batch.map(stripStored) });
      const ids = [
        ...((ack.ids as string[]) ?? []),
        ...(((ack.rejected as { id: string | null }[]) ?? []).map((r) => r.id).filter(Boolean) as string[]),
      ];
      if (!ids.length) throw new Error('Bridge stored nothing from the batch');
      // Only mark the versions we sent: an event patched meanwhile stays unsynced and is resent.
      const sent = new Map(batch.map((e) => [e.id, stripStored(e)]));
      await markSynced(
        ids.filter((id) => sent.has(id)),
        sent,
      );
      await this.setStatus({ state: 'connected', lastAckTs: Date.now(), lastError: undefined });
      if (batch.length < BATCH_SIZE) break;
    }
    await this.setStatus({ pending: await countUnsynced() });
  }
}
