/**
 * URL templating: turns a concrete URL into a screen identifier.
 *
 *   https://erp.example.com/invoices/123/edit?x=1#top  ->  domain "erp.example.com", template "/invoices/{id}/edit"
 *
 * Rules (plan section 7):
 *   - drop the query string and the fragment (except per site keys to keep, like tab or view)
 *   - numeric path segments -> {id}
 *   - uuid shaped segments -> {uuid}
 *   - anything that looks like an email -> {email}
 *   - segments of 16 or more mixed characters -> {token}
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/;
const NUMERIC = /^\d+$/;

export function templateSegment(raw: string): string {
  if (!raw) return raw;
  let seg = raw;
  try {
    seg = decodeURIComponent(raw);
  } catch {}
  if (NUMERIC.test(seg)) return '{id}';
  if (UUID.test(seg)) return '{uuid}';
  if (EMAIL.test(seg)) return '{email}';
  if (isToken(seg)) return '{token}';
  return raw;
}

/** 16+ characters mixing letters and digits (ids, hashes, session tokens). Slugs made of words are kept. */
export function isToken(seg: string): boolean {
  if (seg.length < 16) return false;
  const core = seg.replace(/[-_.~=]/g, '');
  if (core.length < 16) return false;
  const hasDigit = /\d/.test(core);
  const hasLetter = /[a-z]/i.test(core);
  if (hasDigit && hasLetter) return true;
  // long all-hex strings (git hashes without digits are rare but possible)
  if (/^[0-9a-f]{24,}$/i.test(core)) return true;
  // base64ish blobs with mixed case and no separators
  if (!/[-_.]/.test(seg) && /[a-z]/.test(core) && /[A-Z]/.test(core) && core.length >= 20) return true;
  return false;
}

export function normalizeDomain(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\.$/, '');
}

export function keysForDomain(domain: string, keep: Record<string, string[]> | undefined): string[] {
  if (!keep) return [];
  const out: string[] = [];
  for (const [site, keys] of Object.entries(keep)) {
    const s = normalizeDomain(site.trim());
    if (s && (domain === s || domain.endsWith('.' + s))) out.push(...keys);
  }
  return out;
}

export interface Templated {
  domain: string;
  urlTemplate: string;
}

export function templateUrl(url: string, keepQueryKeys?: Record<string, string[]>): Templated {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { domain: '', urlTemplate: '' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { domain: '', urlTemplate: '' };
  }
  const domain = normalizeDomain(u.hostname) + (u.port ? `:${u.port}` : '');
  const path = u.pathname
    .split('/')
    .map((s) => templateSegment(s))
    .join('/');
  const keys = keysForDomain(normalizeDomain(u.hostname), keepQueryKeys);
  const kept: string[] = [];
  for (const k of keys) {
    const v = u.searchParams.get(k);
    if (v !== null) kept.push(`${k}=${templateSegment(v)}`);
  }
  return { domain, urlTemplate: (path || '/') + (kept.length ? `?${kept.join('&')}` : '') };
}

/** True for pages Spoor can record (http and https only). */
export function isRecordableUrl(url: string | undefined): boolean {
  return !!url && /^https?:\/\//i.test(url);
}
