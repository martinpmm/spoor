import { createAdapter, type AdapterConfig } from './base';

export const geminiConfig: AdapterConfig = {
  site: 'gemini',
  matches: ['gemini.google.com'],
  inputSelectors: [
    'rich-textarea .ql-editor[contenteditable="true"]',
    'rich-textarea [contenteditable="true"]',
    'div.ql-editor[contenteditable="true"]',
    'textarea[aria-label*="prompt" i]',
  ],
  sendSelectors: ['button.send-button', 'button[aria-label="Send message"]', 'button[aria-label*="Send" i]'],
};

export const gemini = (doc?: Document) => createAdapter(geminiConfig, doc);
