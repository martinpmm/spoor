import { LABEL_MAX_CHARS } from './constants';
import type { ElementInfo } from './schema';
import { isSensitiveField, type FieldDescriptor } from './sensitive';

/**
 * Element description for interaction events: tag, role and a human label.
 * Label order (plan section 7): aria label, associated label element, placeholder,
 * visible text trimmed to 60 characters. Then title, alt, name and value of buttons.
 */

function squash(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

function trimLabel(s: string): string | undefined {
  const t = squash(s);
  if (!t) return undefined;
  return t.length > LABEL_MAX_CHARS ? t.slice(0, LABEL_MAX_CHARS - 1) + '…' : t;
}

function visibleText(el: Element): string {
  const anyEl = el as HTMLElement;
  // innerText respects CSS visibility but forces layout; textContent is a cheap fallback (jsdom, detached nodes).
  const text =
    typeof anyEl.innerText === 'string' && anyEl.isConnected ? anyEl.innerText : (el.textContent ?? '');
  return squash(text.slice(0, 400));
}

function labelledBy(el: Element): string | undefined {
  const ids = el.getAttribute('aria-labelledby');
  if (!ids) return undefined;
  const doc = el.ownerDocument;
  const text = ids
    .split(/\s+/)
    .map((id) => doc.getElementById(id))
    .filter(Boolean)
    .map((n) => visibleText(n!))
    .join(' ');
  return squash(text) || undefined;
}

function associatedLabel(el: Element): string | undefined {
  const labels = (el as HTMLInputElement).labels;
  if (labels && labels.length) {
    const t = squash(
      Array.from(labels)
        .map((l) => visibleText(l))
        .join(' '),
    );
    if (t) return t;
  }
  const id = el.getAttribute('id');
  if (id) {
    const l = el.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (l) return visibleText(l) || undefined;
  }
  const parent = el.closest('label');
  if (parent) return visibleText(parent) || undefined;
  return undefined;
}

export function resolveLabel(el: Element): string | undefined {
  const tag = el.tagName.toLowerCase();
  const isField = tag === 'input' || tag === 'select' || tag === 'textarea';
  const candidates: (string | null | undefined)[] = [
    el.getAttribute('aria-label'),
    labelledBy(el),
    associatedLabel(el),
    el.getAttribute('placeholder'),
  ];
  if (!isField || ['button', 'submit', 'reset'].includes((el as HTMLInputElement).type)) {
    candidates.push(visibleText(el));
  }
  candidates.push(el.getAttribute('title'), el.getAttribute('alt'));
  if (tag === 'input' && ['button', 'submit', 'reset'].includes((el as HTMLInputElement).type)) {
    candidates.push((el as HTMLInputElement).value);
  }
  if (isField) candidates.push(el.getAttribute('name'), el.getAttribute('id'));
  for (const c of candidates) {
    const t = c ? trimLabel(c) : undefined;
    if (t) return t;
  }
  return undefined;
}

export function describeElement(el: Element): ElementInfo {
  const info: ElementInfo = { tag: el.tagName.toLowerCase() };
  const role = el.getAttribute('role');
  if (role) info.role = role;
  else if (info.tag === 'input') info.role = (el as HTMLInputElement).type || 'text';
  const label = resolveLabel(el);
  if (label) info.label = label;
  return info;
}

/** Builds the descriptor the sensitive rules look at. */
export function fieldDescriptor(el: Element): FieldDescriptor {
  return {
    tag: el.tagName.toLowerCase(),
    type: el.getAttribute('type') ?? (el as HTMLInputElement).type ?? undefined,
    autocomplete: el.getAttribute('autocomplete') ?? undefined,
    name: el.getAttribute('name') ?? undefined,
    id: el.getAttribute('id') ?? undefined,
    label: associatedLabel(el) ?? labelledBy(el),
    placeholder: el.getAttribute('placeholder') ?? undefined,
    ariaLabel: el.getAttribute('aria-label') ?? undefined,
    optOut: !!el.closest('[data-spoor="ignore"]'),
  };
}

export function isSensitiveElement(el: Element | null | undefined): boolean {
  if (!el) return false;
  return isSensitiveField(fieldDescriptor(el));
}

/** Elements whose click is meaningful by itself. */
export const INTERACTIVE_SELECTOR =
  'a[href], button, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], [role="switch"], [role="radio"], input[type="button"], input[type="submit"], input[type="reset"], input[type="image"], label, [onclick]';

const TEXT_ENTRY_TYPES = new Set([
  'text',
  'search',
  'email',
  'url',
  'tel',
  'number',
  'password',
  'date',
  'datetime-local',
  'month',
  'week',
  'time',
  'color',
  'range',
  'checkbox',
  'radio',
  'file',
  'hidden',
  '',
]);

/** Clicks into fields are noise: the change event describes them better. */
export function isFieldElement(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select' || tag === 'option') return true;
  if (tag === 'input') return TEXT_ENTRY_TYPES.has(((el as HTMLInputElement).type || '').toLowerCase());
  return (el as HTMLElement).isContentEditable === true || el.getAttribute('contenteditable') === 'true';
}
