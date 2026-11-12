import type { BridgeStatus } from './bridgeClient';
import type { AiSite, CapturedInteraction } from './schema';
import type { Settings } from './settings';

/** Messages sent to the background worker with chrome.runtime.sendMessage. */
export type Message =
  | { kind: 'interaction'; event: CapturedInteraction }
  | { kind: 'aiHealth'; site: AiSite; healthy: boolean; detail?: string }
  | { kind: 'getStatus' }
  | { kind: 'pause'; minutes: number | null }
  | { kind: 'resume' }
  | { kind: 'setSiteRecording'; domain: string; record: boolean }
  | { kind: 'deleteAll' }
  | { kind: 'reconnectBridge' }
  | { kind: 'flushBridge' };

export interface StatusResponse {
  settings: Settings;
  recording: boolean;
  paused: boolean;
  pausedUntil: number | null;
  bridge: BridgeStatus;
  counts: { today: number; total: number; unsynced: number };
  currentSite: { domain: string; inScope: boolean; recordable: boolean } | null;
  sessionId: string | null;
  extensionId: string;
}

export interface AiHealthEntry {
  healthy: boolean;
  checkedAt: number;
  detail?: string;
}

export const AI_HEALTH_KEY = 'aiHealth';

export function send<T = unknown>(msg: Message): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>;
}
