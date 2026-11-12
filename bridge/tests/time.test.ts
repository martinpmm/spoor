import { describe, expect, it } from 'vitest';
import { parseTime, resolveRange } from '../src/time.js';

const NOW = new Date(2026, 10, 10, 15, 30).getTime();

describe('time parsing', () => {
  it('parses days, relative ranges and keywords', () => {
    expect(parseTime('2026-11-09', 'start', NOW)).toBe(new Date(2026, 10, 9).getTime());
    expect(parseTime('2026-11-09', 'end', NOW)).toBe(new Date(2026, 10, 10).getTime() - 1);
    expect(parseTime('today', 'start', NOW)).toBe(new Date(2026, 10, 10).getTime());
    expect(parseTime('yesterday', 'start', NOW)).toBe(new Date(2026, 10, 9).getTime());
    expect(parseTime('7d', 'start', NOW)).toBe(NOW - 7 * 86_400_000);
    expect(parseTime('2h', 'start', NOW)).toBe(NOW - 2 * 3_600_000);
    expect(parseTime(12345, 'start', NOW)).toBe(12345);
    expect(parseTime('1762790000000', 'start', NOW)).toBe(1762790000000);
    expect(parseTime('2026-11-09T10:00:00Z', 'start', NOW)).toBe(Date.UTC(2026, 10, 9, 10));
    expect(parseTime(undefined, 'start', NOW)).toBeUndefined();
    expect(() => parseTime('banana', 'start', NOW)).toThrow();
  });

  it('defaults to the last 7 days and validates order', () => {
    expect(resolveRange(undefined, undefined, 7, NOW)).toEqual({ from: NOW - 7 * 86_400_000, to: NOW });
    expect(() => resolveRange('today', 'yesterday', 7, NOW)).toThrow();
  });
});
