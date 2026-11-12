import { createAdapter, type AdapterConfig } from './base';

export const chatgptConfig: AdapterConfig = {
  site: 'chatgpt',
  matches: ['chatgpt.com', 'chat.openai.com'],
  inputSelectors: [
    '#prompt-textarea',
    'div.ProseMirror[contenteditable="true"]',
    'textarea[data-testid="prompt-textarea"]',
    'form textarea',
  ],
  sendSelectors: [
    'button[data-testid="send-button"]',
    '#composer-submit-button',
    'button[aria-label="Send prompt"]',
    'button[aria-label*="Send" i]',
  ],
};

export const chatgpt = (doc?: Document) => createAdapter(chatgptConfig, doc);
