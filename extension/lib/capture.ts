import { CLIPBOARD_MAX_CHARS, THROTTLE_MS, VALUE_MAX_CHARS } from './constants';
import { describeElement, INTERACTIVE_SELECTOR, isFieldElement, isSensitiveElement } from './elements';
import type { CapturedInteraction, ValueInfo } from './schema';

/**
 * Interaction capture for one document (content script). Listens in the capture phase for
 * click, submit, change, copy, paste, file inputs and drops, and reports one clean event per
 * action. Typed values are reported once per field when the value is final (change / blur),
 * never per keystroke. Sensitive fields (see sensitive.ts) produce no event at all.
 */

export interface CaptureOptions {
  send: (ev: CapturedInteraction) => void;
  /** Recording allowed right now (scope and pause). Checked on every event. */
  enabled: () => boolean;
  /** Record typed text; when false only lengths are sent. */
  captureValues: () => boolean;
  /** Elements owned by an AI adapter (prompt boxes): their text is reported as ai_prompt instead. */
  isPromptElement?: (el: Element) => boolean;
  now?: () => number;
}

function trimValue(text: string, max: number): ValueInfo['text'] {
  return text.length > max ? text.slice(0, max) : text;
}

function closestElement(node: EventTarget | null): Element | null {
  if (!node) return null;
  if ((node as Node).nodeType === 1) return node as Element;
  return (node as Node).parentElement ?? null;
}

/** The real target, looking through open shadow roots. */
function eventTarget(e: Event): Element | null {
  const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
  for (const n of path) if ((n as Node).nodeType === 1) return n as Element;
  return closestElement(e.target);
}

export function installCapture(doc: Document, opts: CaptureOptions): () => void {
  const now = opts.now ?? (() => Date.now());
  const recent = new Map<string, number>();
  const editableStart = new WeakMap<Element, string>();

  // Strictly increasing timestamps keep the order of events fired in the same millisecond
  // (blur → change → click → submit) when they are sorted later.
  let lastTs = 0;
  const emit = (ev: Omit<CapturedInteraction, 'ts' | 'url' | 'title'>) => {
    if (!opts.enabled()) return;
    const ts = Math.max(now(), lastTs + 1);
    lastTs = ts;
    const key = `${ev.type}|${ev.element?.tag}|${ev.element?.label}|${ev.value?.text}`;
    const last = recent.get(key);
    if (last !== undefined && ts - last < THROTTLE_MS) return;
    recent.set(key, ts);
    if (recent.size > 200) for (const [k, t] of recent) if (ts - t > THROTTLE_MS) recent.delete(k);
    const value = ev.value && !opts.captureValues() ? { ...ev.value, text: '' } : ev.value;
    opts.send({ ...ev, value, ts, url: doc.location?.href ?? '', title: doc.title });
  };

  const onClick = (e: MouseEvent) => {
    const target = eventTarget(e);
    if (!target) return;
    const el = target.closest(INTERACTIVE_SELECTOR) ?? target;
    if (isSensitiveElement(el) || isFieldElement(el)) return;
    if (el.tagName === 'LABEL') {
      const control = (el as HTMLLabelElement).control;
      if (control && (isSensitiveElement(control) || isFieldElement(control))) return;
    }
    if (opts.isPromptElement?.(el)) return;
    emit({ type: 'click', element: describeElement(el) });
  };

  const onSubmit = (e: SubmitEvent) => {
    const form = eventTarget(e);
    if (!form || form.tagName !== 'FORM') return;
    const element = describeElement(form);
    if (!form.getAttribute('aria-label') && !form.getAttribute('aria-labelledby')) {
      const submitter =
        e.submitter ?? form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
      const label = submitter ? describeElement(submitter).label : undefined;
      element.label = label ?? form.getAttribute('name') ?? form.getAttribute('id') ?? element.label;
      if (!element.label) delete element.label;
    }
    emit({ type: 'submit', element });
  };

  const fieldValue = (el: Element): ValueInfo | null => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') {
      const sel = el as HTMLSelectElement;
      const text = Array.from(sel.selectedOptions)
        .map((o) => o.text.trim())
        .join(', ');
      return { kind: 'select', text: trimValue(text, VALUE_MAX_CHARS), chars: text.length };
    }
    if (tag === 'input') {
      const input = el as HTMLInputElement;
      const type = (input.type || 'text').toLowerCase();
      if (type === 'checkbox' || type === 'radio') {
        if (type === 'radio' && !input.checked) return null;
        return { kind: 'checkbox', text: input.checked ? 'on' : 'off', chars: input.checked ? 2 : 3 };
      }
      if (type === 'file') return null;
      const text = input.value ?? '';
      return { kind: 'text', text: trimValue(text, VALUE_MAX_CHARS), chars: text.length };
    }
    if (tag === 'textarea') {
      const text = (el as HTMLTextAreaElement).value ?? '';
      return { kind: 'text', text: trimValue(text, VALUE_MAX_CHARS), chars: text.length };
    }
    return null;
  };

  const fileNames = (files: FileList | null | undefined): string | null => {
    if (!files || !files.length) return null;
    return Array.from(files)
      .map((f) => f.name)
      .join(', ');
  };

  const onChange = (e: Event) => {
    const el = eventTarget(e);
    if (!el || isSensitiveElement(el)) return;
    if (opts.isPromptElement?.(el)) return;
    if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'file') {
      const names = fileNames((el as HTMLInputElement).files);
      if (!names) return;
      emit({
        type: 'upload',
        element: describeElement(el),
        value: { kind: 'file', text: trimValue(names, VALUE_MAX_CHARS), chars: names.length },
      });
      return;
    }
    const value = fieldValue(el);
    if (!value) return;
    emit({ type: 'change', element: describeElement(el), value });
  };

  // Rich text editors (contenteditable) do not fire change: compare text on focus and blur.
  const editableRoot = (el: Element | null): Element | null => {
    if (!el) return null;
    const h = el as HTMLElement;
    if (!h.isContentEditable && el.getAttribute('contenteditable') !== 'true') return null;
    let root: Element = el;
    while (
      root.parentElement &&
      ((root.parentElement as HTMLElement).isContentEditable ||
        root.parentElement.getAttribute('contenteditable') === 'true')
    ) {
      root = root.parentElement;
    }
    return root;
  };
  const onFocusIn = (e: FocusEvent) => {
    const root = editableRoot(eventTarget(e));
    if (root) editableStart.set(root, (root as HTMLElement).innerText ?? root.textContent ?? '');
  };
  const onFocusOut = (e: FocusEvent) => {
    const root = editableRoot(eventTarget(e));
    if (!root || isSensitiveElement(root) || opts.isPromptElement?.(root)) return;
    const before = editableStart.get(root);
    const text = ((root as HTMLElement).innerText ?? root.textContent ?? '').trim();
    editableStart.delete(root);
    if (before === undefined || before.trim() === text) return;
    emit({
      type: 'change',
      element: describeElement(root),
      value: { kind: 'text', text: trimValue(text, VALUE_MAX_CHARS), chars: text.length },
    });
  };

  const selectionText = (): { text: string; source: Element | null } => {
    const active = doc.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
      const f = active as HTMLInputElement;
      try {
        if (f.selectionStart !== null && f.selectionEnd !== null && f.selectionEnd > f.selectionStart) {
          return { text: f.value.slice(f.selectionStart, f.selectionEnd), source: active };
        }
      } catch {}
    }
    const sel = doc.getSelection?.();
    const text = sel ? sel.toString() : '';
    return { text, source: closestElement(sel?.anchorNode ?? null) };
  };

  const onCopy = (e: ClipboardEvent) => {
    const { text, source } = selectionText();
    const el = source ?? eventTarget(e);
    if (el && isSensitiveElement(el.closest('input, textarea, [contenteditable="true"]') ?? el)) return;
    if (!text) return;
    // Describe fields and controls by their label; for plain page text keep only the tag,
    // otherwise the "label" would just repeat the copied text.
    const described =
      el?.closest('input, textarea, select, [contenteditable="true"]') ?? el?.closest(INTERACTIVE_SELECTOR);
    emit({
      type: 'copy',
      element: described ? describeElement(described) : el ? { tag: el.tagName.toLowerCase() } : undefined,
      value: { kind: 'clipboard', text: trimValue(text, CLIPBOARD_MAX_CHARS), chars: text.length },
    });
  };

  const onPaste = (e: ClipboardEvent) => {
    const el = eventTarget(e);
    if (!el) return;
    const field = el.closest('input, textarea, select, [contenteditable="true"]') ?? el;
    if (isSensitiveElement(field)) return;
    const text = e.clipboardData?.getData('text/plain') ?? '';
    const names = fileNames(e.clipboardData?.files);
    if (!text && names) {
      emit({
        type: 'upload',
        element: describeElement(field),
        value: { kind: 'file', text: names, chars: names.length },
      });
      return;
    }
    emit({
      type: 'paste',
      element: describeElement(field),
      value: { kind: 'clipboard', text: trimValue(text, CLIPBOARD_MAX_CHARS), chars: text.length },
    });
  };

  const onDrop = (e: DragEvent) => {
    const names = fileNames(e.dataTransfer?.files);
    if (!names) return;
    const el = eventTarget(e);
    if (!el || isSensitiveElement(el)) return;
    // A drop onto a file input also fires change on it; that one is reported by onChange.
    if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'file') return;
    emit({
      type: 'upload',
      element: describeElement(el),
      value: { kind: 'file', text: trimValue(names, VALUE_MAX_CHARS), chars: names.length },
    });
  };

  const listeners: [string, EventListener][] = [
    ['click', onClick as EventListener],
    ['submit', onSubmit as EventListener],
    ['change', onChange],
    ['focusin', onFocusIn as EventListener],
    ['focusout', onFocusOut as EventListener],
    ['copy', onCopy as EventListener],
    ['cut', onCopy as EventListener],
    ['paste', onPaste as EventListener],
    ['drop', onDrop as EventListener],
  ];
  for (const [type, fn] of listeners) doc.addEventListener(type, fn, { capture: true, passive: true });
  return () => {
    for (const [type, fn] of listeners) doc.removeEventListener(type, fn, { capture: true });
  };
}
