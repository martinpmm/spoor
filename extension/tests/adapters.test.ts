// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { adapterForHost, ADAPTER_CONFIGS, createHealthCheck, HEALTH_WAIT_SECONDS } from '../adapters';

/** Minimal markup that mirrors each site's composer. Update together with the adapter selectors. */
const MARKUP: Record<string, { host: string; html: string; input: string; send: string }> = {
  chatgpt: {
    host: 'chatgpt.com',
    html: `<form><div id="prompt-textarea" contenteditable="true" class="ProseMirror"><p></p></div><button data-testid="send-button">Send</button></form>`,
    input: '#prompt-textarea',
    send: 'button[data-testid="send-button"]',
  },
  claude: {
    host: 'claude.ai',
    html: `<fieldset><div contenteditable="true" class="ProseMirror"><p></p></div><button aria-label="Send message">↑</button></fieldset>`,
    input: '.ProseMirror',
    send: 'button[aria-label="Send message"]',
  },
  gemini: {
    host: 'gemini.google.com',
    html: `<rich-textarea><div class="ql-editor" contenteditable="true"><p></p></div></rich-textarea><button class="send-button" aria-label="Send message">Send</button>`,
    input: '.ql-editor',
    send: 'button.send-button',
  },
  copilot: {
    host: 'copilot.microsoft.com',
    html: `<textarea id="userInput" placeholder="Message Copilot"></textarea><button data-testid="submit-button" aria-label="Submit message">Go</button>`,
    input: '#userInput',
    send: 'button[data-testid="submit-button"]',
  },
};

function setText(el: Element, text: string) {
  if (el instanceof HTMLTextAreaElement) el.value = text;
  else el.textContent = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('AI adapters', () => {
  it('there is one adapter per site', () => {
    expect(ADAPTER_CONFIGS.map((c) => c.site).sort()).toEqual(['chatgpt', 'claude', 'copilot', 'gemini']);
    expect(adapterForHost('www.example.com')).toBeNull();
    expect(adapterForHost('chat.openai.com')?.site).toBe('chatgpt');
  });

  for (const [site, m] of Object.entries(MARKUP)) {
    describe(site, () => {
      it('reports one prompt per send (Enter and button click)', () => {
        document.body.innerHTML = m.html;
        const a = adapterForHost(m.host)!;
        expect(a.site).toBe(site);
        expect(a.healthy()).toBe(true);
        const got: string[] = [];
        const stop = a.onPrompt((t) => got.push(t));
        const input = document.querySelector(m.input)!;
        expect(a.isPromptElement(input)).toBe(true);

        setText(input, 'Summarize this invoice');
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        // the button click right after Enter is the same prompt: deduplicated
        (document.querySelector(m.send) as HTMLElement).click();
        expect(got).toEqual(['Summarize this invoice']);

        setText(input, 'Second question');
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
        expect(got).toHaveLength(1); // Shift+Enter is a new line, not a send
        (document.querySelector(m.send) as HTMLElement).click();
        expect(got).toEqual(['Summarize this invoice', 'Second question']);
        stop();
      });

      it('is unhealthy when the selectors break', () => {
        document.body.innerHTML = '<div>redesigned page</div>';
        expect(adapterForHost(m.host)!.healthy()).toBe(false);
      });
    });
  }

  describe('health check', () => {
    const steps = (check: () => string, n: number) => Array.from({ length: n }, () => check());

    it('claude: a page without a prompt box by design is not a broken adapter', () => {
      document.body.innerHTML = '<div>a published artifact</div>';
      const a = adapterForHost('claude.ai')!;
      expect(a.expectsPrompt('/artifact/E4ZH6yeKM2r8oKe1kxPzL4')).toBe(false);
      expect(a.expectsPrompt('/settings/profile')).toBe(false);
      expect(a.expectsPrompt('/login')).toBe(false);
      expect(a.expectsPrompt('/new')).toBe(true);
      expect(a.expectsPrompt('/chat/8c2f1d9e-0b7a-4c55-9a51-2f3e4d5c6b7a')).toBe(true);
      expect(a.expectsPrompt('/project/8c2f1d9e-0b7a-4c55-9a51-2f3e4d5c6b7a')).toBe(true);
      const check = createHealthCheck(a, () => '/artifact/E4ZH6yeKM2r8oKe1kxPzL4');
      expect(new Set(steps(check, HEALTH_WAIT_SECONDS + 5))).toEqual(new Set(['not_expected']));
    });

    it('is broken only after the prompt box stays missing where it is expected', () => {
      document.body.innerHTML = '<div>redesigned page</div>';
      const check = createHealthCheck(adapterForHost('claude.ai')!, () => '/new');
      expect(new Set(steps(check, HEALTH_WAIT_SECONDS - 1))).toEqual(new Set(['waiting']));
      expect(check()).toBe('broken');
      expect(check()).toBe('broken');
      // the composer loads late: the alarm recovers
      document.body.innerHTML = MARKUP.claude.html;
      expect(check()).toBe('healthy');
    });

    it('starts over when a single page app changes view', () => {
      document.body.innerHTML = '<div>a published artifact</div>';
      let path = '/artifact/E4ZH6yeKM2r8oKe1kxPzL4';
      const check = createHealthCheck(adapterForHost('claude.ai')!, () => path);
      expect(check()).toBe('not_expected');
      path = '/new';
      expect(new Set(steps(check, HEALTH_WAIT_SECONDS - 1))).toEqual(new Set(['waiting']));
      path = '/chat/8c2f1d9e-0b7a-4c55-9a51-2f3e4d5c6b7a';
      expect(check()).toBe('waiting'); // counted again from zero
    });

    it('sites without promptPaths expect the prompt box everywhere', () => {
      expect(adapterForHost('chatgpt.com')!.expectsPrompt('/anything')).toBe(true);
    });
  });
});
