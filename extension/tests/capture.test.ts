// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { installCapture } from '../lib/capture';
import { describeElement, resolveLabel } from '../lib/elements';
import type { CapturedInteraction } from '../lib/schema';

let events: CapturedInteraction[] = [];
let stop: () => void = () => {};
let now = 1000;

function setup(html: string, opts: { captureValues?: boolean; enabled?: boolean } = {}) {
  stop();
  document.body.innerHTML = html;
  events = [];
  stop = installCapture(document, {
    send: (e) => events.push(e),
    enabled: () => opts.enabled ?? true,
    captureValues: () => opts.captureValues ?? true,
    now: () => now,
  });
}

function change(el: Element) {
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('element labels', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  it('resolves aria label, label element, placeholder, then visible text', () => {
    document.body.innerHTML = `
      <button id="a" aria-label="Close dialog">×</button>
      <label for="b">Customer name</label><input id="b">
      <label>Amount <input id="c"></label>
      <input id="d" placeholder="Search invoices">
      <a id="e" href="#">  Open   the invoice  </a>
      <button id="f">${'x'.repeat(100)}</button>
      <span id="lbl">Due date</span><input id="g" aria-labelledby="lbl">`;
    expect(resolveLabel(document.getElementById('a')!)).toBe('Close dialog');
    expect(resolveLabel(document.getElementById('b')!)).toBe('Customer name');
    expect(resolveLabel(document.getElementById('c')!)).toBe('Amount');
    expect(resolveLabel(document.getElementById('d')!)).toBe('Search invoices');
    expect(resolveLabel(document.getElementById('e')!)).toBe('Open the invoice');
    expect(resolveLabel(document.getElementById('f')!)).toHaveLength(60);
    expect(resolveLabel(document.getElementById('g')!)).toBe('Due date');
    expect(describeElement(document.getElementById('b')!)).toEqual({
      tag: 'input',
      role: 'text',
      label: 'Customer name',
    });
  });
});

describe('capture', () => {
  it('records clicks on buttons and links but not clicks into fields', () => {
    setup(
      `<button id="save"><span id="inner">Save invoice</span></button><input id="name"><a id="l" href="#">Next</a>`,
    );
    document.getElementById('inner')!.click();
    document.getElementById('name')!.click();
    document.getElementById('l')!.click();
    expect(events.map((e) => [e.type, e.element?.label])).toEqual([
      ['click', 'Save invoice'],
      ['click', 'Next'],
    ]);
  });

  it('throttles identical events within 500 ms', () => {
    setup(`<button id="b">Go</button>`);
    const b = document.getElementById('b')!;
    b.click();
    now += 100;
    b.click();
    now += 600;
    b.click();
    expect(events).toHaveLength(2);
  });

  it('records the final value of text, number, select, checkbox and textarea fields', () => {
    setup(`
      <label for="t">Customer</label><input id="t">
      <label for="n">Amount</label><input id="n" type="number">
      <label for="s">Status</label><select id="s"><option>Draft</option><option>Paid</option></select>
      <label><input id="c" type="checkbox"> Paid</label>
      <label for="x">Notes</label><textarea id="x"></textarea>`);
    const t = document.getElementById('t') as HTMLInputElement;
    t.value = 'Acme';
    change(t);
    const n = document.getElementById('n') as HTMLInputElement;
    n.value = '120.5';
    change(n);
    const s = document.getElementById('s') as HTMLSelectElement;
    s.selectedIndex = 1;
    change(s);
    const c = document.getElementById('c') as HTMLInputElement;
    c.checked = true;
    change(c);
    const x = document.getElementById('x') as HTMLTextAreaElement;
    x.value = 'y'.repeat(1500);
    change(x);
    expect(
      events.map((e) => [e.element?.label, e.value?.kind, e.value?.text.slice(0, 10), e.value?.chars]),
    ).toEqual([
      ['Customer', 'text', 'Acme', 4],
      ['Amount', 'text', '120.5', 5],
      ['Status', 'select', 'Paid', 4],
      ['Paid', 'checkbox', 'on', 2],
      ['Notes', 'text', 'yyyyyyyyyy', 1500],
    ]);
    expect(events[4].value!.text).toHaveLength(1000);
  });

  it('sends lengths only when value capture is off', () => {
    setup(`<label for="t">Customer</label><input id="t">`, { captureValues: false });
    const t = document.getElementById('t') as HTMLInputElement;
    t.value = 'Acme';
    change(t);
    expect(events[0].value).toEqual({ kind: 'text', text: '', chars: 4 });
  });

  it('records nothing when disabled (excluded site or paused)', () => {
    setup(`<button id="b">Go</button>`, { enabled: false });
    document.getElementById('b')!.click();
    expect(events).toHaveLength(0);
  });

  it('sensitive fields produce no event at all', () => {
    setup(`
      <form>
        <label for="p">Password</label><input id="p" type="password">
        <label for="cc">Card</label><input id="cc" autocomplete="cc-number">
        <label for="o">Code</label><input id="o" autocomplete="one-time-code">
        <label for="pin">PIN</label><input id="pin">
        <input id="h" type="hidden" value="x">
        <div data-spoor="ignore"><input id="ig"></div>
      </form>`);
    for (const id of ['p', 'cc', 'o', 'pin', 'h', 'ig']) {
      const el = document.getElementById(id) as HTMLInputElement;
      el.value = 'hunter2';
      change(el);
      el.click();
      const paste = new Event('paste', { bubbles: true }) as ClipboardEvent;
      Object.defineProperty(paste, 'clipboardData', { value: { getData: () => 'hunter2', files: [] } });
      el.dispatchEvent(paste);
      el.focus();
      el.dispatchEvent(new Event('copy', { bubbles: true }));
    }
    // clicking the label of a sensitive field is not recorded either
    (document.querySelector('label[for="p"]') as HTMLElement).click();
    expect(events).toEqual([]);
  });

  it('records paste with clipboard text trimmed to 200 characters', () => {
    setup(`<label for="i">IBAN</label><input id="i">`);
    const el = document.getElementById('i')!;
    const paste = new Event('paste', { bubbles: true }) as ClipboardEvent;
    const text = 'E'.repeat(250);
    Object.defineProperty(paste, 'clipboardData', { value: { getData: () => text, files: [] } });
    el.dispatchEvent(paste);
    expect(events[0]).toMatchObject({
      type: 'paste',
      element: { label: 'IBAN' },
      value: { kind: 'clipboard', chars: 250 },
    });
    expect(events[0].value!.text).toHaveLength(200);
  });

  it('records copy of selected text', () => {
    setup(`<p id="p">IBAN ES91 2100 0418</p>`);
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('p')!);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    document.dispatchEvent(new Event('copy', { bubbles: true }));
    expect(events[0]).toMatchObject({
      type: 'copy',
      value: { kind: 'clipboard', text: 'IBAN ES91 2100 0418' },
    });
  });

  it('records submit with the submit button label', () => {
    setup(`<form id="f"><input name="a"><button type="submit">Save invoice</button></form>`);
    const f = document.getElementById('f') as HTMLFormElement;
    f.addEventListener('submit', (e) => e.preventDefault());
    f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(events[0]).toMatchObject({ type: 'submit', element: { tag: 'form', label: 'Save invoice' } });
  });

  it('records file uploads with file names only', () => {
    setup(`<label for="f">Attachment</label><input id="f" type="file">`);
    const f = document.getElementById('f') as HTMLInputElement;
    const file = new File(['%PDF secret content'], 'invoice-1001.pdf', { type: 'application/pdf' });
    Object.defineProperty(f, 'files', { value: [file] });
    change(f);
    expect(events).toEqual([
      expect.objectContaining({
        type: 'upload',
        element: expect.objectContaining({ label: 'Attachment' }),
        value: { kind: 'file', text: 'invoice-1001.pdf', chars: 16 },
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain('secret content');
  });
});
