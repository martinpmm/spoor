import { describe, expect, it } from 'vitest';
import { isRecordableUrl, isToken, templateSegment, templateUrl } from '../lib/urlTemplate';

describe('urlTemplate', () => {
  it('drops query string and fragment', () => {
    expect(templateUrl('https://erp.example.com/invoices?page=2&sort=asc#top')).toEqual({
      domain: 'erp.example.com',
      urlTemplate: '/invoices',
    });
  });

  it('replaces numeric ids', () => {
    expect(templateUrl('https://erp.example.com/invoices/123/edit').urlTemplate).toBe('/invoices/{id}/edit');
    expect(templateUrl('https://x.com/a/1/b/22/c/333').urlTemplate).toBe('/a/{id}/b/{id}/c/{id}');
  });

  it('replaces uuids', () => {
    expect(templateUrl('https://x.com/chat/8c2f1d9e-0b7a-4c55-9a51-2f3e4d5c6b7a').urlTemplate).toBe(
      '/chat/{uuid}',
    );
    expect(templateSegment('8C2F1D9E-0B7A-4C55-9A51-2F3E4D5C6B7A')).toBe('{uuid}');
  });

  it('replaces long mixed tokens but keeps word slugs', () => {
    expect(templateUrl('https://x.com/share/a1b2c3d4e5f6g7h8i9').urlTemplate).toBe('/share/{token}');
    expect(
      templateUrl('https://x.com/doc/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit').urlTemplate,
    ).toBe('/doc/{token}/edit');
    expect(
      templateUrl('https://github.com/x/y/commit/3f786850e387550fdab836ed7e6dc881de23001b').urlTemplate,
    ).toBe('/x/y/commit/{token}');
    expect(templateUrl('https://blog.example.com/how-to-automate-everything-today').urlTemplate).toBe(
      '/how-to-automate-everything-today',
    );
    expect(isToken('short1234')).toBe(false);
    expect(isToken('implementation_plan_for_spoor')).toBe(false);
  });

  it('replaces emails', () => {
    expect(templateUrl('https://crm.example.com/contacts/jane.doe@acme.com/notes').urlTemplate).toBe(
      '/contacts/{email}/notes',
    );
    expect(templateUrl('https://crm.example.com/contacts/jane.doe%40acme.com').urlTemplate).toBe(
      '/contacts/{email}',
    );
  });

  it('keeps per site query keys', () => {
    const keep = { 'app.example.com': ['tab', 'view'] };
    expect(templateUrl('https://app.example.com/settings?tab=billing&x=1&view=42', keep).urlTemplate).toBe(
      '/settings?tab=billing&view={id}',
    );
    expect(templateUrl('https://sub.app.example.com/s?tab=a', keep).urlTemplate).toBe('/s?tab=a');
    expect(templateUrl('https://other.com/s?tab=a', keep).urlTemplate).toBe('/s');
  });

  it('normalizes the domain and keeps ports', () => {
    expect(templateUrl('https://WWW.Example.COM/').domain).toBe('example.com');
    expect(templateUrl('http://localhost:4321/x').domain).toBe('localhost:4321');
    expect(templateUrl('https://example.com').urlTemplate).toBe('/');
  });

  it('ignores non web pages', () => {
    expect(templateUrl('chrome://settings')).toEqual({ domain: '', urlTemplate: '' });
    expect(templateUrl('not a url')).toEqual({ domain: '', urlTemplate: '' });
    expect(isRecordableUrl('file:///etc/passwd')).toBe(false);
    expect(isRecordableUrl('https://a.com')).toBe(true);
  });
});
