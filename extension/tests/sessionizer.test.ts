import { describe, expect, it } from 'vitest';
import { SESSION_IDLE_MS } from '../lib/constants';
import { sessionize, touchSession } from '../lib/sessionizer';

let n = 0;
const id = () => `s${++n}`;
const MIN = 60_000;

describe('sessionizer', () => {
  it('starts a session on the first activity and keeps it while active', () => {
    const a = touchSession(null, 1000, id);
    expect(a.isNew).toBe(true);
    const b = touchSession(a.state, 1000 + 4 * MIN, id);
    expect(b.isNew).toBe(false);
    expect(b.state.sessionId).toBe(a.state.sessionId);
    expect(b.state.lastActivityTs).toBe(1000 + 4 * MIN);
  });

  it('starts a new session after more than 5 minutes idle', () => {
    const a = touchSession(null, 0, id);
    expect(touchSession(a.state, SESSION_IDLE_MS, id).isNew).toBe(false);
    expect(touchSession(a.state, SESSION_IDLE_MS + 1, id).isNew).toBe(true);
  });

  it('starts a new session on browser restart and when returning from idle', () => {
    const a = touchSession(null, 0, id);
    expect(touchSession(a.state, 10, id, 'startup').isNew).toBe(true);
    expect(touchSession(a.state, 10, id, 'idle-return').isNew).toBe(true);
  });

  it('never moves lastActivityTs backwards (late events from another window)', () => {
    const a = touchSession(null, 5000, id);
    const b = touchSession(a.state, 4000, id);
    expect(b.isNew).toBe(false);
    expect(b.state.lastActivityTs).toBe(5000);
  });

  it('offline: idle gaps', () => {
    expect(sessionize([0, MIN, 2 * MIN, 10 * MIN, 11 * MIN])).toEqual([0, 0, 0, 1, 1]);
  });

  it('offline: browser restart splits even without a gap', () => {
    expect(sessionize([0, MIN, 2 * MIN, 3 * MIN], SESSION_IDLE_MS, [1.5 * MIN])).toEqual([0, 0, 1, 1]);
  });

  it('offline: overlapping windows share one session', () => {
    // window A and window B used side by side, events interleaved and given out of order
    const a = [0, 2 * MIN, 4 * MIN, 6 * MIN];
    const b = [1 * MIN, 3 * MIN, 5 * MIN];
    const all = [...a, ...b];
    expect(new Set(sessionize(all))).toEqual(new Set([0]));
  });
});
