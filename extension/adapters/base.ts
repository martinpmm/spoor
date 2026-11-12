import type { AiSite } from '../lib/schema';

/**
 * AI site adapters. Each adapter knows where the prompt box and the send button are on one
 * AI chat site, and reports every prompt the user sends.
 *
 * These pages change often. When the selectors stop matching, healthy() returns false,
 * the dashboard shows a warning, and Spoor falls back to time on site only.
 * See CONTRIBUTING.md, "How to fix an adapter".
 */
export interface AiAdapter {
  site: AiSite;
  /** Host names the adapter runs on (exact or subdomain). */
  matches: string[];
  /** Starts listening; cb gets the prompt text once per sent prompt. Returns a stop function. */
  onPrompt(cb: (text: string) => void): () => void;
  /** True when the prompt box is found on the page. */
  healthy(): boolean;
  /** False for pages of the site that have no prompt box by design (a published artifact, settings, login). */
  expectsPrompt(pathname: string): boolean;
  /** True for the prompt box (and its children): generic value capture skips it. */
  isPromptElement(el: Element): boolean;
}

export interface AdapterConfig {
  site: AiSite;
  matches: string[];
  /** Prompt box candidates, most specific first. */
  inputSelectors: string[];
  /** Send button candidates, most specific first. */
  sendSelectors: string[];
  /**
   * Paths where the prompt box is expected. A missing prompt box only counts as a broken adapter
   * there: other pages of the site (a published artifact, settings, login) have none by design.
   * Leave out to expect it on every page.
   */
  promptPaths?: RegExp[];
}

const DEDUPE_MS = 2000;

export function readPromptText(el: Element | null): string {
  if (!el) return '';
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return el.value.trim();
  const h = el as HTMLElement;
  const text =
    typeof h.innerText === 'string' && h.isConnected && h.innerText ? h.innerText : (el.textContent ?? '');
  return text.replace(/\u00a0/g, ' ').trim();
}

export function createAdapter(cfg: AdapterConfig, doc: Document = document): AiAdapter {
  const findInput = (): Element | null => {
    for (const s of cfg.inputSelectors) {
      const el = doc.querySelector(s);
      if (el) return el;
    }
    return null;
  };
  const inputOf = (el: Element | null): Element | null => {
    if (!el) return null;
    for (const s of cfg.inputSelectors) {
      const m = el.closest(s);
      if (m) return m;
    }
    return null;
  };
  const isSend = (el: Element | null): boolean => {
    if (!el) return false;
    return cfg.sendSelectors.some((s) => el.closest(s));
  };

  return {
    site: cfg.site,
    matches: cfg.matches,
    healthy: () => findInput() !== null,
    expectsPrompt: (pathname) => !cfg.promptPaths || cfg.promptPaths.some((p) => p.test(pathname)),
    isPromptElement: (el) => inputOf(el) !== null,
    onPrompt(cb) {
      let lastText = '';
      let lastAt = 0;
      // Last non-empty text seen in the box: some sites clear it before our click handler runs.
      let draft = '';
      const fire = (text: string) => {
        const t = text.trim();
        if (!t) return;
        const now = Date.now();
        if (t === lastText && now - lastAt < DEDUPE_MS) return;
        lastText = t;
        lastAt = now;
        draft = '';
        cb(t);
      };
      const onInput = (e: Event) => {
        const box = inputOf(e.target as Element);
        if (box) draft = readPromptText(box) || draft;
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.altKey) return;
        const box = inputOf(e.target as Element);
        if (!box) return;
        fire(readPromptText(box) || draft);
      };
      const onClick = (e: MouseEvent) => {
        const target = e.target as Element | null;
        if (!isSend(target)) return;
        const btn = target!.closest('button');
        if (btn && (btn.disabled || btn.getAttribute('aria-disabled') === 'true')) return;
        fire(readPromptText(findInput()) || draft);
      };
      const onSubmit = (e: Event) => {
        const form = e.target as Element;
        const box = cfg.inputSelectors.map((s) => form.querySelector?.(s)).find(Boolean) ?? null;
        if (box) fire(readPromptText(box) || draft);
      };
      doc.addEventListener('input', onInput, true);
      doc.addEventListener('keydown', onKey, true);
      doc.addEventListener('click', onClick, true);
      doc.addEventListener('submit', onSubmit, true);
      return () => {
        doc.removeEventListener('input', onInput, true);
        doc.removeEventListener('keydown', onKey, true);
        doc.removeEventListener('click', onClick, true);
        doc.removeEventListener('submit', onSubmit, true);
      };
    },
  };
}

/** Checks in a row, one per second, before a missing prompt box counts as a broken adapter. */
export const HEALTH_WAIT_SECONDS = 20;

export type HealthState =
  /** The prompt box is on the page. */
  | 'healthy'
  /** Expected but not there yet: check again in a second. */
  | 'waiting'
  /** Expected and still missing after HEALTH_WAIT_SECONDS checks: the selectors need an update. */
  | 'broken'
  /** This page has no prompt box by design. */
  | 'not_expected';

/**
 * Returns a function to call once per second while it answers 'waiting', and now and then
 * afterwards. Single page apps swap views without a page load, so the count starts over on
 * every new path, and a page judged 'broken' turns 'healthy' as soon as the prompt box shows up.
 */
export function createHealthCheck(
  adapter: Pick<AiAdapter, 'healthy' | 'expectsPrompt'>,
  getPath: () => string,
): () => HealthState {
  let path = getPath();
  let missing = 0;
  return () => {
    const now = getPath();
    if (now !== path) {
      path = now;
      missing = 0;
    }
    if (adapter.healthy()) {
      missing = 0;
      return 'healthy';
    }
    if (!adapter.expectsPrompt(path)) {
      missing = 0;
      return 'not_expected';
    }
    if (missing < HEALTH_WAIT_SECONDS) missing++;
    return missing < HEALTH_WAIT_SECONDS ? 'waiting' : 'broken';
  };
}

export function hostMatches(host: string, patterns: string[]): boolean {
  const h = host.toLowerCase();
  return patterns.some((p) => h === p || h.endsWith('.' + p));
}
