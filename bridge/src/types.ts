/**
 * Event schema, version 1. Kept identical to extension/lib/schema.ts.
 * See docs/EVENT_SCHEMA.md.
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

export const AI_SITES = ['chatgpt', 'claude', 'gemini', 'copilot'] as const;
export type AiSite = (typeof AI_SITES)[number];

export type ValueKind = 'text' | 'select' | 'checkbox' | 'file' | 'clipboard';

export interface SpoorEvent {
  v: 1;
  id: string;
  ts: number;
  sessionId: string;
  tabId: number;
  windowId: number;
  type: EventType;
  domain: string;
  urlTemplate: string;
  title?: string;
  durationMs?: number;
  element?: {
    tag: string;
    role?: string;
    label?: string;
  };
  value?: {
    kind: ValueKind;
    text: string;
    chars: number;
  };
  ai?: {
    site: AiSite;
    chars: number;
    text?: string;
  };
}

/** Settings the extension pushes to the bridge, stored in the meta table. */
export interface BridgeSettings {
  /** "Let Claude read typed values". When false, tools return lengths instead of text. */
  claudeReadsValues: boolean;
  retentionDays?: number;
}

export const DEFAULT_BRIDGE_SETTINGS: BridgeSettings = {
  claudeReadsValues: true,
};

/** Activity-level event types: the ones that describe what the user did. */
export const ACTIVITY_TYPES: EventType[] = [
  'nav',
  'click',
  'submit',
  'change',
  'copy',
  'paste',
  'upload',
  'ai_prompt',
];
