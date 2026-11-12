/**
 * Spoor event schema, version 1. One row per event.
 * Documented in docs/EVENT_SCHEMA.md; mirrored in bridge/src/types.ts.
 */
export const EVENT_TYPES = [
  'nav',
  'focus',
  'blur',
  'idle',
  'active',
  'click',
  'submit',
  'change',
  'copy',
  'paste',
  'upload',
  'ai_prompt',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export type AiSite = 'chatgpt' | 'claude' | 'gemini' | 'copilot';
export const AI_SITES: AiSite[] = ['chatgpt', 'claude', 'gemini', 'copilot'];

export type ValueKind = 'text' | 'select' | 'checkbox' | 'file' | 'clipboard';

export interface ElementInfo {
  tag: string; // "button", "input", "a"
  role?: string;
  label?: string; // visible label or aria label
}

export interface ValueInfo {
  kind: ValueKind;
  text: string; // final value, trimmed to 1000 characters
  chars: number; // original length
}

export interface AiInfo {
  site: AiSite;
  chars: number;
  text?: string; // prompt text, recorded by default
}

export interface SpoorEvent {
  v: 1; // schema version
  id: string; // uuid
  ts: number; // epoch milliseconds
  sessionId: string;
  tabId: number;
  windowId: number;
  type: EventType;
  domain: string;
  urlTemplate: string; // "/invoices/{id}/edit"
  title?: string;
  durationMs?: number; // filled when the user leaves the page
  element?: ElementInfo;
  value?: ValueInfo;
  ai?: AiInfo;
}

/** What IndexedDB stores: the event plus a sync flag (0 = not yet confirmed by the bridge). */
export interface StoredEvent extends SpoorEvent {
  synced: 0 | 1;
}

/** Interaction captured by the content script; the background worker fills in the rest. */
export interface CapturedInteraction {
  type: Extract<EventType, 'click' | 'submit' | 'change' | 'copy' | 'paste' | 'upload' | 'ai_prompt'>;
  ts: number;
  url: string;
  title?: string;
  element?: ElementInfo;
  value?: ValueInfo;
  ai?: AiInfo;
}

export function stripStored(e: StoredEvent | SpoorEvent): SpoorEvent {
  const { synced: _s, ...rest } = e as StoredEvent;
  return rest;
}
