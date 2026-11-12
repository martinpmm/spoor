/**
 * Parses the `from` / `to` arguments of the MCP tools.
 *
 * Accepted forms:
 *   - epoch milliseconds (number or numeric string)
 *   - "YYYY-MM-DD" (local day; start of day for `from`, end of day for `to`)
 *   - any ISO 8601 date time
 *   - "now", "today", "yesterday"
 *   - relative: "7d", "12h", "30m" (that long ago)
 */
export function parseTime(
  input: string | number | undefined,
  edge: 'start' | 'end',
  now = Date.now(),
): number | undefined {
  if (input === undefined || input === null || input === '') return undefined;
  if (typeof input === 'number') return input;
  const s = String(input).trim().toLowerCase();
  if (/^\d{10,}$/.test(s)) return Number(s);
  if (s === 'now') return now;
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const DAY = 86_400_000;
  if (s === 'today')
    return edge === 'start' ? startOfDay(new Date(now)) : startOfDay(new Date(now)) + DAY - 1;
  if (s === 'yesterday') {
    const y = startOfDay(new Date(now)) - DAY;
    return edge === 'start' ? y : y + DAY - 1;
  }
  const rel = /^(\d+(?:\.\d+)?)\s*(d|h|m|w)$/.exec(s);
  if (rel) {
    const mult = { m: 60_000, h: 3_600_000, d: DAY, w: 7 * DAY }[rel[2] as 'm' | 'h' | 'd' | 'w'];
    return now - Number(rel[1]) * mult;
  }
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (day) {
    const start = new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])).getTime();
    return edge === 'start' ? start : start + DAY - 1;
  }
  const t = Date.parse(String(input));
  if (Number.isNaN(t))
    throw new Error(
      `Could not parse time "${input}". Use YYYY-MM-DD, ISO 8601, epoch ms, today, yesterday or 7d.`,
    );
  return t;
}

export function resolveRange(
  from: string | number | undefined,
  to: string | number | undefined,
  defaultDays = 7,
  now = Date.now(),
): { from: number; to: number } {
  const f = parseTime(from, 'start', now) ?? now - defaultDays * 86_400_000;
  const t = parseTime(to, 'end', now) ?? now;
  if (f > t) throw new Error('`from` is after `to`.');
  return { from: f, to: t };
}

export function iso(ts: number | null | undefined): string | null {
  if (ts === null || ts === undefined) return null;
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
  );
}
