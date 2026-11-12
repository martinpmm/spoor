import { stripStored, type SpoorEvent, type StoredEvent } from './schema';

export function toJsonl(events: (SpoorEvent | StoredEvent)[]): string {
  return events.map((e) => JSON.stringify(stripStored(e))).join('\n') + (events.length ? '\n' : '');
}

export const CSV_COLUMNS = [
  'id',
  'ts',
  'time',
  'sessionId',
  'tabId',
  'windowId',
  'type',
  'domain',
  'urlTemplate',
  'title',
  'durationMs',
  'elementTag',
  'elementRole',
  'elementLabel',
  'valueKind',
  'valueText',
  'valueChars',
  'aiSite',
  'aiChars',
  'aiText',
] as const;

function cell(v: unknown): string {
  if (v === undefined || v === null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(events: (SpoorEvent | StoredEvent)[]): string {
  const rows = [CSV_COLUMNS.join(',')];
  for (const e of events) {
    rows.push(
      [
        e.id,
        e.ts,
        new Date(e.ts).toISOString(),
        e.sessionId,
        e.tabId,
        e.windowId,
        e.type,
        e.domain,
        e.urlTemplate,
        e.title,
        e.durationMs,
        e.element?.tag,
        e.element?.role,
        e.element?.label,
        e.value?.kind,
        e.value?.text,
        e.value?.chars,
        e.ai?.site,
        e.ai?.chars,
        e.ai?.text,
      ]
        .map(cell)
        .join(','),
    );
  }
  return rows.join('\r\n') + '\r\n';
}

export function download(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
