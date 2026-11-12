import { createAdapter, type AdapterConfig } from './base';

export const claudeConfig: AdapterConfig = {
  site: 'claude',
  matches: ['claude.ai'],
  inputSelectors: [
    'div.ProseMirror[contenteditable="true"]',
    '[data-testid="chat-input"] [contenteditable="true"]',
    'fieldset [contenteditable="true"]',
    'div[contenteditable="true"][aria-label*="prompt" i]',
  ],
  sendSelectors: [
    'button[aria-label="Send message"]',
    'button[aria-label*="Send" i]',
    'button[data-testid="send-button"]',
  ],
  // Chats and projects. claude.ai also serves pages without a composer: /artifact/…, /settings, /login.
  promptPaths: [/^\/(new|chat|project)(\/|$)/],
};

export const claude = (doc?: Document) => createAdapter(claudeConfig, doc);
