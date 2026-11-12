import { createAdapter, hostMatches, type AdapterConfig, type AiAdapter } from './base';
import { chatgptConfig } from './chatgpt';
import { claudeConfig } from './claude';
import { copilotConfig } from './copilot';
import { geminiConfig } from './gemini';

export const ADAPTER_CONFIGS: AdapterConfig[] = [chatgptConfig, claudeConfig, geminiConfig, copilotConfig];

export function adapterForHost(host: string, doc: Document = document): AiAdapter | null {
  const cfg = ADAPTER_CONFIGS.find((c) => hostMatches(host, c.matches));
  return cfg ? createAdapter(cfg, doc) : null;
}

export { createHealthCheck, HEALTH_WAIT_SECONDS } from './base';
export type { AiAdapter } from './base';
