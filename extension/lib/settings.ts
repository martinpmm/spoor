export type ScopeMode = 'all' | 'exclude' | 'allow';

export interface Settings {
  /** "all" (default), "exclude" (all sites except excludeList), "allow" (only allowList). */
  scopeMode: ScopeMode;
  excludeList: string[];
  allowList: string[];
  /** Record the final text of fields and clipboard. When off, only lengths are stored. */
  captureValues: boolean;
  /** Record the text of AI prompts. When off, only lengths are stored. */
  aiPromptText: boolean;
  /** "Let Claude read typed values": pushed to the bridge, honored by every MCP tool. */
  claudeReadsValues: boolean;
  retentionDays: number;
  /** Per site query keys kept in URL templates, for example { "app.example.com": ["tab", "view"] }. */
  keepQueryKeys: Record<string, string[]>;
  /** Epoch ms until which recording is paused. PAUSE_FOREVER = until resumed. null = recording. */
  pausedUntil: number | null;
}

export const PAUSE_FOREVER = 8_640_000_000_000_000; // max Date

export const DEFAULT_SETTINGS: Settings = {
  scopeMode: 'all',
  excludeList: [],
  allowList: [],
  captureValues: true,
  aiPromptText: true,
  claudeReadsValues: true,
  retentionDays: 30,
  keepQueryKeys: {},
  pausedUntil: null,
};

const KEY = 'settings';

export function normalizeSettings(raw: Partial<Settings> | undefined): Settings {
  const s = { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
  if (!['all', 'exclude', 'allow'].includes(s.scopeMode)) s.scopeMode = 'all';
  s.excludeList = Array.isArray(s.excludeList) ? s.excludeList : [];
  s.allowList = Array.isArray(s.allowList) ? s.allowList : [];
  s.retentionDays = Math.max(1, Math.min(3650, Math.round(Number(s.retentionDays) || 30)));
  if (!s.keepQueryKeys || typeof s.keepQueryKeys !== 'object') s.keepQueryKeys = {};
  return s;
}

export async function getSettings(): Promise<Settings> {
  const r = await chrome.storage.local.get(KEY);
  return normalizeSettings(r[KEY] as Partial<Settings> | undefined);
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const s = normalizeSettings({ ...(await getSettings()), ...patch });
  await chrome.storage.local.set({ [KEY]: s });
  return s;
}

export function onSettingsChanged(cb: (s: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[KEY]) cb(normalizeSettings(changes[KEY].newValue as Partial<Settings>));
  });
}

export const SETTINGS_KEY = KEY;
