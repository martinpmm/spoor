import { normalizeDomain } from './urlTemplate';
import type { Settings } from './settings';

/**
 * Recording scope: all sites (default), all sites except a list, or only listed sites.
 * List entries are domains; they also match subdomains. "*.example.com" is accepted too.
 */

export function normalizePattern(entry: string): string {
  let p = entry.trim().toLowerCase();
  if (!p) return '';
  p = p.replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '');
  p = p.replace(/^\*\./, '');
  return normalizeDomain(p);
}

export function domainMatches(domain: string, entry: string): boolean {
  const p = normalizePattern(entry);
  if (!p) return false;
  const d = normalizeDomain(domain).replace(/:\d+$/, '');
  return d === p || d.endsWith('.' + p);
}

export function isInScope(
  domain: string,
  s: Pick<Settings, 'scopeMode' | 'excludeList' | 'allowList'>,
): boolean {
  if (!domain) return false;
  if (s.scopeMode === 'allow') return s.allowList.some((e) => domainMatches(domain, e));
  if (s.scopeMode === 'exclude') return !s.excludeList.some((e) => domainMatches(domain, e));
  return true;
}

export function isPaused(s: Pick<Settings, 'pausedUntil'>, now = Date.now()): boolean {
  return s.pausedUntil !== null && s.pausedUntil > now;
}

/** Settings patch that stops recording a site, whatever the current mode. */
export function excludeSitePatch(domain: string, s: Settings): Partial<Settings> {
  const d = normalizePattern(domain);
  if (s.scopeMode === 'allow') return { allowList: s.allowList.filter((e) => !domainMatches(d, e)) };
  return {
    scopeMode: 'exclude',
    excludeList: s.excludeList.some((e) => normalizePattern(e) === d) ? s.excludeList : [...s.excludeList, d],
  };
}

/** Settings patch that starts recording a site again. */
export function includeSitePatch(domain: string, s: Settings): Partial<Settings> {
  const d = normalizePattern(domain);
  if (s.scopeMode === 'allow') return { allowList: [...s.allowList, d] };
  return { excludeList: s.excludeList.filter((e) => !domainMatches(d, e)) };
}
