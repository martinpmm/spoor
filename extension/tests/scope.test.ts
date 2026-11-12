import { describe, expect, it } from 'vitest';
import {
  domainMatches,
  excludeSitePatch,
  includeSitePatch,
  isInScope,
  isPaused,
  normalizePattern,
} from '../lib/scope';
import { DEFAULT_SETTINGS, normalizeSettings, PAUSE_FOREVER } from '../lib/settings';

describe('scope', () => {
  it('matches domains and subdomains', () => {
    expect(domainMatches('mail.google.com', 'google.com')).toBe(true);
    expect(domainMatches('google.com', 'google.com')).toBe(true);
    expect(domainMatches('notgoogle.com', 'google.com')).toBe(false);
    expect(domainMatches('a.b.com', '*.b.com')).toBe(true);
    expect(domainMatches('localhost:4321', 'localhost')).toBe(true);
    expect(normalizePattern(' https://www.Bank.com/login ')).toBe('bank.com');
  });

  it('all sites by default', () => {
    expect(isInScope('anything.com', DEFAULT_SETTINGS)).toBe(true);
    expect(isInScope('', DEFAULT_SETTINGS)).toBe(false);
  });

  it('exclude list', () => {
    const s = { ...DEFAULT_SETTINGS, scopeMode: 'exclude' as const, excludeList: ['bank.com'] };
    expect(isInScope('online.bank.com', s)).toBe(false);
    expect(isInScope('erp.com', s)).toBe(true);
  });

  it('allowlist', () => {
    const s = { ...DEFAULT_SETTINGS, scopeMode: 'allow' as const, allowList: ['erp.com'] };
    expect(isInScope('erp.com', s)).toBe(true);
    expect(isInScope('news.com', s)).toBe(false);
    expect(isInScope('news.com', { ...s, allowList: [] })).toBe(false);
  });

  it('exclude this site / record this site', () => {
    const p = excludeSitePatch('bank.com', DEFAULT_SETTINGS);
    expect(p).toEqual({ scopeMode: 'exclude', excludeList: ['bank.com'] });
    const s = { ...DEFAULT_SETTINGS, ...p };
    expect(isInScope('bank.com', s)).toBe(false);
    expect(isInScope('bank.com', { ...s, ...includeSitePatch('bank.com', s) })).toBe(true);
    const allow = { ...DEFAULT_SETTINGS, scopeMode: 'allow' as const, allowList: ['erp.com'] };
    expect(isInScope('erp.com', { ...allow, ...excludeSitePatch('erp.com', allow) })).toBe(false);
  });

  it('pause', () => {
    expect(isPaused({ pausedUntil: null })).toBe(false);
    expect(isPaused({ pausedUntil: 2000 }, 1000)).toBe(true);
    expect(isPaused({ pausedUntil: 2000 }, 3000)).toBe(false);
    expect(isPaused({ pausedUntil: PAUSE_FOREVER })).toBe(true);
  });

  it('normalizes stored settings', () => {
    expect(normalizeSettings({ scopeMode: 'weird' as never, retentionDays: -4 })).toMatchObject({
      scopeMode: 'all',
      retentionDays: 1,
    });
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });
});
