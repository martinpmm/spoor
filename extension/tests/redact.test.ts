import { describe, expect, it } from 'vitest';
import { redact } from '../lib/redact';

describe('redact', () => {
  it('removes emails', () => {
    expect(redact('Inbox (3) - jane.doe@acme.com - Mail')).toBe('Inbox (3) - [email] - Mail');
  });

  it('removes phone numbers', () => {
    expect(redact('Call +34 612 345 678 today')).toBe('Call [phone] today');
    expect(redact('Contact (555) 123-4567')).toBe('Contact [phone]');
    expect(redact('Tel. 612 34 56 78')).toBe('Tel. [phone]');
    expect(redact('+1-202-555-0143')).toBe('[phone]');
  });

  it('removes long digit strings', () => {
    expect(redact('Order 123456789 shipped')).toBe('Order [number] shipped');
    expect(redact('Account ES9121000418450200051332')).toBe('Account ES[number]');
  });

  it('keeps short numbers, years, dates and amounts', () => {
    expect(redact('Invoice 1001 · Q3 2026')).toBe('Invoice 1001 · Q3 2026');
    expect(redact('Due 2026-11-10')).toBe('Due 2026-11-10');
    expect(redact('Total 1,250.00 EUR')).toBe('Total 1,250.00 EUR');
    expect(redact('Page 3 of 12')).toBe('Page 3 of 12');
  });

  it('passes empty values through', () => {
    expect(redact(undefined)).toBeUndefined();
    expect(redact('')).toBe('');
  });
});
