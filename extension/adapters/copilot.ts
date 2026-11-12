import { createAdapter, type AdapterConfig } from './base';

export const copilotConfig: AdapterConfig = {
  site: 'copilot',
  matches: ['copilot.microsoft.com'],
  inputSelectors: [
    'textarea#userInput',
    'textarea[data-testid="composer-input"]',
    'textarea[placeholder*="Copilot" i]',
    'textarea[aria-label*="message" i]',
  ],
  sendSelectors: [
    'button[data-testid="submit-button"]',
    'button[aria-label="Submit message"]',
    'button[aria-label*="Submit" i]',
    'button[title*="Submit" i]',
  ],
};

export const copilot = (doc?: Document) => createAdapter(copilotConfig, doc);
