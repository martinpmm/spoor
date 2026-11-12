import { SESSION_IDLE_MS } from './constants';

/**
 * Session rules (plan section 7): a new session starts after 5 minutes of idle time
 * or when the browser starts. Sessions are per browser, not per window: two windows
 * used side by side share one session.
 */

export interface SessionState {
  sessionId: string;
  startedAt: number;
  lastActivityTs: number;
}

export type SessionReason = 'activity' | 'startup' | 'idle-return';

export function newSession(now: number, makeId: () => string): SessionState {
  return { sessionId: makeId(), startedAt: now, lastActivityTs: now };
}

/**
 * Returns the session an activity at `now` belongs to.
 * Starts a new one on browser startup, after returning from idle, or when the gap since the
 * last activity exceeds the idle threshold (covers laptop sleep, where no idle event fires).
 */
export function touchSession(
  state: SessionState | null | undefined,
  now: number,
  makeId: () => string,
  reason: SessionReason = 'activity',
  idleMs = SESSION_IDLE_MS,
): { state: SessionState; isNew: boolean } {
  if (!state || reason === 'startup' || reason === 'idle-return' || now - state.lastActivityTs > idleMs) {
    return { state: newSession(now, makeId), isNew: true };
  }
  return { state: { ...state, lastActivityTs: Math.max(state.lastActivityTs, now) }, isNew: false };
}

/**
 * Offline sessionizer for a list of timestamps (used in tests and to re-split imported logs).
 * Returns the session index of each timestamp, in input order.
 */
export function sessionize(
  timestamps: number[],
  idleMs = SESSION_IDLE_MS,
  restarts: number[] = [],
): number[] {
  const order = timestamps.map((ts, i) => ({ ts, i })).sort((a, b) => a.ts - b.ts);
  const out = new Array<number>(timestamps.length);
  const rs = [...restarts].sort((a, b) => a - b);
  let session = -1;
  let last = -Infinity;
  let r = 0;
  for (const { ts, i } of order) {
    let restarted = false;
    while (r < rs.length && rs[r] <= ts) {
      if (rs[r] > last) restarted = true;
      r++;
    }
    if (session < 0 || restarted || ts - last > idleMs) session++;
    out[i] = session;
    last = ts;
  }
  return out;
}
