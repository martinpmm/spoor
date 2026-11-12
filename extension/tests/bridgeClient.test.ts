import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BridgeClient, getBridgeStatus } from '../lib/bridgeClient';

/**
 * A fake native port: answers "hello" after `delayMs`, unless it was disconnected first.
 * Like Chrome, it does not fire onDisconnect for a disconnect() called by the extension.
 */
function fakeHost(delayMs: number) {
  const ports: { disconnected: boolean }[] = [];
  const connect = () => {
    const msgListeners: ((m: unknown) => void)[] = [];
    const state = { disconnected: false };
    ports.push(state);
    return {
      onMessage: { addListener: (fn: (m: unknown) => void) => msgListeners.push(fn) },
      onDisconnect: { addListener: () => {} },
      postMessage: (m: { type: string; reqId: string }) => {
        setTimeout(() => {
          if (state.disconnected) return;
          if (m.type === 'hello')
            msgListeners.forEach((fn) => fn({ type: 'hello', reqId: m.reqId, version: 't' }));
        }, delayMs);
      },
      disconnect: () => {
        state.disconnected = true;
      },
    } as unknown as chrome.runtime.Port;
  };
  return { connect, ports };
}

beforeEach(() => {
  const store: Record<string, unknown> = {};
  vi.stubGlobal('chrome', {
    runtime: { lastError: undefined },
    storage: {
      local: {
        get: async (k: string) => ({ [k]: store[k] }),
        set: async (o: Record<string, unknown>) => Object.assign(store, o),
      },
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BridgeClient', () => {
  it('connects when the host answers hello', async () => {
    const host = fakeHost(5);
    const c = new BridgeClient(host.connect);
    expect(await c.ensureConnected()).toBe(true);
    expect((await getBridgeStatus()).state).toBe('connected');
  });

  it('reconnects at once when disconnect() interrupts a connection in progress', async () => {
    const host = fakeHost(50);
    const c = new BridgeClient(host.connect);
    const first = c.ensureConnected(); // e.g. a routine sync starts connecting
    await new Promise((r) => setTimeout(r, 10));
    c.disconnect(); // "Reconnect" arrives before the host answered
    const started = Date.now();
    const second = await c.ensureConnected();
    expect(second).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000); // not the 8 s handshake timeout
    expect(await first).toBe(false);
    expect(host.ports).toHaveLength(2);
    // The interrupted attempt must not overwrite the status of the new connection.
    await new Promise((r) => setTimeout(r, 20));
    expect((await getBridgeStatus()).state).toBe('connected');
    expect(c.connected).toBe(true);
  });
});
