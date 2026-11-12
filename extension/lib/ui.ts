/** Small DOM helpers shared by the extension pages. */

export function $(sel: string, root: ParentNode = document): HTMLElement {
  const el = root.querySelector(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el as HTMLElement;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | undefined> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string): void {
  let el = document.querySelector('.toast') as HTMLElement | null;
  if (!el) {
    el = h('div', { class: 'toast', role: 'status' });
    document.body.append(el);
  }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el!.classList.remove('show'), 2200);
}

export function timeAgo(ts: number | undefined): string {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ts).toLocaleString();
}

export function pausedLabel(until: number | null): string {
  if (until === null) return '';
  if (until > Date.now() + 365 * 86_400_000) return 'Paused until you resume';
  return `Paused until ${new Date(until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}
