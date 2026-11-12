import { BridgeClient, getBridgeStatus } from './bridgeClient';
import { CLIPBOARD_MAX_CHARS, IDLE_DETECTION_SECONDS, SCHEMA_VERSION, VALUE_MAX_CHARS } from './constants';
import { clearAll, countAll, countInRange, countUnsynced, deleteBefore, patchEvent, putEvents } from './db';
import type { StatusResponse } from './messages';
import { redact } from './redact';
import type { CapturedInteraction, EventType, SpoorEvent } from './schema';
import { isInScope, isPaused } from './scope';
import { touchSession, type SessionReason, type SessionState } from './sessionizer';
import { getSettings, type Settings } from './settings';
import { isRecordableUrl, templateUrl } from './urlTemplate';

/**
 * Background recording logic: navigation and attention tracking, sessions, durations,
 * storage in IndexedDB and forwarding to the bridge.
 *
 * The service worker can be stopped by the browser at any time, so all state lives in
 * chrome.storage.session (and the open page view is mirrored in chrome.storage.local so it
 * can be closed after a browser restart). Handlers run one at a time through a queue.
 */

export interface OpenNav {
  id: string;
  ts: number;
  tabId: number;
  windowId: number;
  url: string; // without fragment
  domain: string;
  urlTemplate: string;
}

interface RuntimeState {
  session: SessionState | null;
  openNav: OpenNav | null;
  focusedWindowId: number | null;
  idle: boolean;
  lastSeenTs: number;
}

const STATE_KEY = 'state';
const BACKUP_KEY = 'openNavBackup';
/** If the worker saw nothing for this long, the machine was probably asleep. */
const SLEEP_GAP_MS = 3 * 60_000;

function stripHash(url: string): string {
  const i = url.indexOf('#');
  return i >= 0 ? url.slice(0, i) : url;
}

function uuid(): string {
  return crypto.randomUUID();
}

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

export class Recorder {
  readonly bridge = new BridgeClient();
  private chain: Promise<unknown> = Promise.resolve();

  /** Runs handlers one after the other so read-modify-write on state never interleaves. */
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch((err) => console.warn('[spoor]', err));
    return next;
  }

  private async getState(): Promise<RuntimeState> {
    const r = await chrome.storage.session.get(STATE_KEY);
    return (
      (r[STATE_KEY] as RuntimeState) ?? {
        session: null,
        openNav: null,
        focusedWindowId: null,
        idle: false,
        lastSeenTs: 0,
      }
    );
  }

  private async setState(s: RuntimeState): Promise<void> {
    await chrome.storage.session.set({ [STATE_KEY]: s });
    await chrome.storage.local.set({
      [BACKUP_KEY]: s.openNav ? { nav: s.openNav, lastSeenTs: s.lastSeenTs } : null,
    });
  }

  // ---------------------------------------------------------------- lifecycle

  /** Called every time the worker starts. Closes a stale open page view (worker or machine was stopped). */
  async init(): Promise<void> {
    chrome.idle.setDetectionInterval(IDLE_DETECTION_SECONDS);
    await this.run(async () => {
      const s = await this.getState();
      const now = Date.now();
      if (s.openNav && s.lastSeenTs && now - s.lastSeenTs > SLEEP_GAP_MS) {
        await this.closeNav(s, s.lastSeenTs);
      }
      if (s.focusedWindowId === null) {
        const w = await chrome.windows.getLastFocused().catch(() => null);
        if (w && w.focused && !w.incognito && w.id !== undefined) s.focusedWindowId = w.id;
      }
      await this.setState(s);
    });
    await this.attention();
    await this.updateBadge();
    this.bridge.scheduleFlush(0);
  }

  /** Browser start: close what was open before the restart and force a new session. */
  async onStartup(): Promise<void> {
    await this.run(async () => {
      const r = await chrome.storage.local.get(BACKUP_KEY);
      const backup = r[BACKUP_KEY] as { nav: OpenNav; lastSeenTs: number } | null | undefined;
      if (backup?.nav) {
        await patchEvent(backup.nav.id, { durationMs: Math.max(0, backup.lastSeenTs - backup.nav.ts) });
      }
      const s = await this.getState();
      s.openNav = null;
      s.session = null; // next event starts a new session
      await this.setState(s);
    });
    await this.attention();
  }

  /** Every minute: heartbeat for durations, sleep detection and bridge retry. */
  async heartbeat(): Promise<void> {
    await this.run(async () => {
      const s = await this.getState();
      const now = Date.now();
      if (s.openNav && s.lastSeenTs && now - s.lastSeenTs > SLEEP_GAP_MS) {
        // Missed heartbeats: the machine slept. End the page view where we last saw it.
        await this.closeNav(s, s.lastSeenTs);
      }
      s.lastSeenTs = now;
      await this.setState(s);
    });
    await this.attention();
    void this.bridge.flush();
  }

  // ---------------------------------------------------------------- recording

  /**
   * Stores one event. Applies pause, scope and incognito rules, assigns the session,
   * templates the URL and redacts title and label. Returns the event or null when dropped.
   */
  private async record(
    s: RuntimeState,
    settings: Settings,
    input: {
      type: EventType;
      ts: number;
      tabId: number;
      windowId: number;
      url?: string;
      domain?: string;
      urlTemplate?: string;
      title?: string;
      element?: SpoorEvent['element'];
      value?: SpoorEvent['value'];
      ai?: SpoorEvent['ai'];
    },
    reason: SessionReason = 'activity',
  ): Promise<SpoorEvent | null> {
    if (isPaused(settings, input.ts)) return null;
    let domain = input.domain ?? '';
    let urlTemplate = input.urlTemplate ?? '';
    if (input.url !== undefined) {
      if (!isRecordableUrl(input.url)) return null;
      ({ domain, urlTemplate } = templateUrl(input.url, settings.keepQueryKeys));
    }
    if (domain && !isInScope(domain, settings)) return null;

    const t = touchSession(s.session, input.ts, uuid, reason);
    s.session = t.state;
    s.lastSeenTs = Math.max(s.lastSeenTs, input.ts);

    const e: SpoorEvent = {
      v: SCHEMA_VERSION,
      id: uuid(),
      ts: input.ts,
      sessionId: t.state.sessionId,
      tabId: input.tabId,
      windowId: input.windowId,
      type: input.type,
      domain,
      urlTemplate,
    };
    const title = redact(input.title?.trim());
    if (title) e.title = clip(title, 300);
    if (input.element) {
      e.element = { tag: input.element.tag.toLowerCase() };
      if (input.element.role) e.element.role = input.element.role;
      const label = redact(input.element.label);
      if (label) e.element.label = label;
    }
    if (input.value) {
      const max = input.value.kind === 'clipboard' ? CLIPBOARD_MAX_CHARS : VALUE_MAX_CHARS;
      e.value = {
        kind: input.value.kind,
        text: settings.captureValues ? clip(input.value.text, max) : '',
        chars: input.value.chars,
      };
    }
    if (input.ai) {
      e.ai = { site: input.ai.site, chars: input.ai.chars };
      if (settings.aiPromptText && input.ai.text !== undefined) e.ai.text = input.ai.text;
    }
    await putEvents([e]);
    this.bridge.scheduleFlush();
    return e;
  }

  private async closeNav(s: RuntimeState, endTs: number): Promise<void> {
    const open = s.openNav;
    if (!open) return;
    s.openNav = null;
    await patchEvent(open.id, { durationMs: Math.max(0, Math.round(endTs - open.ts)) });
    this.bridge.scheduleFlush();
  }

  /**
   * Recomputes which page has the user's attention (active tab of the focused window) and
   * opens or closes page views accordingly. `forceTabId` starts a new page view for that
   * tab even if the URL did not change (reload or a new navigation to the same address).
   */
  attention(opts: { forceTabId?: number; reason?: SessionReason } = {}): Promise<void> {
    return this.run(async () => {
      const settings = await getSettings();
      const s = await this.getState();
      const now = Date.now();
      let tab: chrome.tabs.Tab | undefined;
      if (!s.idle && s.focusedWindowId !== null) {
        [tab] = await chrome.tabs.query({ active: true, windowId: s.focusedWindowId }).catch(() => []);
      }
      const url = tab?.url ?? tab?.pendingUrl;
      const ok =
        tab &&
        tab.id !== undefined &&
        !tab.incognito &&
        isRecordableUrl(url) &&
        !isPaused(settings, now) &&
        isInScope(templateUrl(url!).domain, settings);

      if (!ok) {
        await this.closeNav(s, now);
        await this.setState(s);
        await this.badgeForTab(tab, settings);
        return;
      }
      const cleanUrl = stripHash(url!);
      if (
        s.openNav &&
        s.openNav.tabId === tab!.id &&
        s.openNav.url === cleanUrl &&
        opts.forceTabId !== tab!.id
      ) {
        s.lastSeenTs = now;
        await this.setState(s);
        return;
      }
      await this.closeNav(s, now);
      const e = await this.record(
        s,
        settings,
        { type: 'nav', ts: now, tabId: tab!.id!, windowId: tab!.windowId, url: cleanUrl, title: tab!.title },
        opts.reason,
      );
      if (e) {
        s.openNav = {
          id: e.id,
          ts: e.ts,
          tabId: tab!.id!,
          windowId: tab!.windowId,
          url: cleanUrl,
          domain: e.domain,
          urlTemplate: e.urlTemplate,
        };
      }
      await this.setState(s);
      await this.badgeForTab(tab, settings);
    });
  }

  /** Page title arrives after the navigation: store it on the open page view. */
  onTitle(tabId: number, title: string): Promise<void> {
    return this.run(async () => {
      const s = await this.getState();
      if (!s.openNav || s.openNav.tabId !== tabId) return;
      const t = redact(title.trim());
      if (t) await patchEvent(s.openNav.id, { title: t.slice(0, 300) });
      this.bridge.scheduleFlush();
    });
  }

  onTabRemoved(tabId: number): Promise<void> {
    return this.run(async () => {
      const s = await this.getState();
      if (s.openNav?.tabId === tabId) {
        await this.closeNav(s, Date.now());
        await this.setState(s);
      }
    });
  }

  async onFocusChanged(windowId: number): Promise<void> {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
      // On some systems NONE fires briefly when switching between two browser windows.
      await new Promise((r) => setTimeout(r, 250));
      const w = await chrome.windows.getLastFocused().catch(() => null);
      if (w?.focused && w.id !== undefined && !w.incognito) windowId = w.id;
    } else {
      const w = await chrome.windows.get(windowId).catch(() => null);
      if (!w || w.incognito) windowId = chrome.windows.WINDOW_ID_NONE;
    }
    await this.run(async () => {
      const settings = await getSettings();
      const s = await this.getState();
      const now = Date.now();
      const none = windowId === chrome.windows.WINDOW_ID_NONE;
      if (none) {
        if (s.focusedWindowId !== null) {
          const nav = s.openNav;
          await this.closeNav(s, now);
          await this.record(s, settings, {
            type: 'blur',
            ts: now,
            tabId: nav?.tabId ?? -1,
            windowId: s.focusedWindowId,
            domain: nav?.domain,
            urlTemplate: nav?.urlTemplate,
          });
          s.focusedWindowId = null;
        }
      } else {
        const wasNone = s.focusedWindowId === null;
        s.focusedWindowId = windowId;
        if (wasNone && !s.idle) {
          await this.record(s, settings, { type: 'focus', ts: now, tabId: -1, windowId });
        }
      }
      await this.setState(s);
    });
    await this.attention();
  }

  async onIdleState(state: string): Promise<void> {
    const now = Date.now();
    if (state === 'active') {
      await this.run(async () => {
        const settings = await getSettings();
        const s = await this.getState();
        if (!s.idle) return;
        s.idle = false;
        await this.record(
          s,
          settings,
          { type: 'active', ts: now, tabId: -1, windowId: s.focusedWindowId ?? -1 },
          'idle-return',
        );
        await this.setState(s);
      });
      await this.attention();
      return;
    }
    await this.run(async () => {
      const settings = await getSettings();
      const s = await this.getState();
      if (s.idle) return;
      s.idle = true;
      // The browser reports idle after IDLE_DETECTION_SECONDS without input: the page view ended back then.
      const idleSince = now - IDLE_DETECTION_SECONDS * 1000;
      const nav = s.openNav;
      await this.closeNav(s, Math.max(nav?.ts ?? idleSince, idleSince));
      await this.record(s, settings, {
        type: 'idle',
        ts: Math.max(nav?.ts ?? idleSince, idleSince),
        tabId: nav?.tabId ?? -1,
        windowId: nav?.windowId ?? -1,
        domain: nav?.domain,
        urlTemplate: nav?.urlTemplate,
      });
      await this.setState(s);
    });
  }

  /** An interaction captured by the content script. */
  onInteraction(ev: CapturedInteraction, sender: chrome.runtime.MessageSender): Promise<void> {
    const tab = sender.tab;
    if (!tab || tab.incognito || tab.id === undefined || sender.frameId !== 0) return Promise.resolve();
    return this.run(async () => {
      const settings = await getSettings();
      const s = await this.getState();
      // Content script timestamps may run a few ms ahead (they are kept strictly increasing).
      const ts = Math.min(Date.now() + 1000, ev.ts || Date.now());
      // sender.url is the URL the document loaded with; single page apps change it with pushState,
      // so prefer the content script's current location when it is on the same origin.
      const loaded = sender.url ?? tab.url ?? '';
      let url = loaded;
      try {
        if (ev.url && new URL(ev.url).origin === new URL(loaded).origin) url = ev.url;
      } catch {}
      await this.record(s, settings, {
        type: ev.type,
        ts,
        tabId: tab.id!,
        windowId: tab.windowId,
        url: stripHash(url),
        title: tab.title ?? ev.title,
        element: ev.element,
        value: ev.value,
        ai: ev.ai,
      });
      await this.setState(s);
    });
  }

  // ---------------------------------------------------------------- controls

  async deleteAll(): Promise<void> {
    await this.run(async () => {
      const s = await this.getState();
      s.openNav = null;
      await clearAll();
      await this.setState(s);
      await this.bridge.queueCommand({ type: 'deleteAll' });
    });
    await this.attention();
  }

  async applyRetention(): Promise<void> {
    const settings = await getSettings();
    const before = Date.now() - settings.retentionDays * 86_400_000;
    await deleteBefore(before);
    await this.bridge.queueCommand({ type: 'prune', before });
  }

  async pushSettingsToBridge(): Promise<void> {
    const s = await getSettings();
    await this.bridge.queueCommand({
      type: 'settings',
      settings: { claudeReadsValues: s.claudeReadsValues, retentionDays: s.retentionDays },
    });
  }

  // ---------------------------------------------------------------- badge and status

  private async badgeForTab(tab: chrome.tabs.Tab | undefined, settings: Settings): Promise<void> {
    const paused = isPaused(settings);
    await chrome.action.setBadgeText({ text: paused ? 'OFF' : 'REC' });
    await chrome.action.setBadgeBackgroundColor({ color: paused ? '#6b7280' : '#dc2626' });
    if (tab?.id !== undefined) {
      const url = tab.url ?? '';
      // OFF when paused or the site is out of scope; pages that are not web pages show the global state.
      const on = !paused && (!isRecordableUrl(url) || isInScope(templateUrl(url).domain, settings));
      await chrome.action.setBadgeText({ tabId: tab.id, text: on ? 'REC' : 'OFF' }).catch(() => {});
      await chrome.action
        .setBadgeBackgroundColor({ tabId: tab.id, color: on ? '#dc2626' : '#6b7280' })
        .catch(() => {});
    }
  }

  async updateBadge(): Promise<void> {
    const settings = await getSettings();
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
    await this.badgeForTab(tab, settings);
  }

  async status(): Promise<StatusResponse> {
    const settings = await getSettings();
    const s = await this.getState();
    const now = Date.now();
    const startOfDay = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
    let currentSite: StatusResponse['currentSite'] = null;
    if (tab?.url) {
      const recordable = isRecordableUrl(tab.url);
      const domain = recordable ? templateUrl(tab.url).domain : '';
      currentSite = { domain, recordable, inScope: recordable && isInScope(domain, settings) };
    }
    const paused = isPaused(settings, now);
    return {
      settings,
      recording: !paused,
      paused,
      pausedUntil: paused ? settings.pausedUntil : null,
      bridge: { ...(await getBridgeStatus()), pending: await countUnsynced() },
      counts: {
        today: await countInRange(startOfDay, now + 1),
        total: await countAll(),
        unsynced: await countUnsynced(),
      },
      currentSite,
      sessionId: s.session?.sessionId ?? null,
      extensionId: chrome.runtime.id,
    };
  }
}
