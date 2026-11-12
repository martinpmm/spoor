import { defineBackground } from 'wxt/utils/define-background';
import { AI_HEALTH_KEY, type AiHealthEntry, type Message } from '../lib/messages';
import { Recorder } from '../lib/recorder';
import { excludeSitePatch, includeSitePatch } from '../lib/scope';
import { getSettings, PAUSE_FOREVER, SETTINGS_KEY, updateSettings, type Settings } from '../lib/settings';

export default defineBackground({
  type: 'module',
  main() {
    const recorder = new Recorder();

    // ---- install, startup, alarms
    chrome.runtime.onInstalled.addListener(async (details) => {
      if (details.reason === 'install') {
        await updateSettings({});
        await chrome.tabs.create({ url: chrome.runtime.getURL('/onboarding.html') });
      }
      // A new version can ship fixed adapters: drop old health reports, each site is checked again on its next visit.
      if (details.reason === 'update') await chrome.storage.local.remove(AI_HEALTH_KEY);
      await recorder.pushSettingsToBridge();
    });
    chrome.runtime.onStartup.addListener(() => void recorder.onStartup());

    chrome.alarms.create('heartbeat', { periodInMinutes: 1 });
    chrome.alarms.create('retention', { periodInMinutes: 24 * 60, delayInMinutes: 1 });
    chrome.alarms.onAlarm.addListener(async (alarm) => {
      if (alarm.name === 'heartbeat') await recorder.heartbeat();
      else if (alarm.name === 'retention') await recorder.applyRetention();
      else if (alarm.name === 'resume') {
        const s = await getSettings();
        if (s.pausedUntil !== null && s.pausedUntil <= Date.now())
          await updateSettings({ pausedUntil: null });
      }
    });

    // ---- navigation and attention
    chrome.tabs.onActivated.addListener(() => void recorder.attention());
    chrome.tabs.onRemoved.addListener((tabId) => void recorder.onTabRemoved(tabId));
    chrome.tabs.onUpdated.addListener((tabId, info) => {
      if (info.title) void recorder.onTitle(tabId, info.title);
    });
    chrome.webNavigation.onCommitted.addListener((d) => {
      if (d.frameId === 0) void recorder.attention({ forceTabId: d.tabId });
    });
    // Single page apps change the URL with history.pushState / replaceState.
    chrome.webNavigation.onHistoryStateUpdated.addListener((d) => {
      if (d.frameId === 0) void recorder.attention();
    });
    chrome.windows.onFocusChanged.addListener((windowId) => void recorder.onFocusChanged(windowId));
    chrome.idle.onStateChanged.addListener((state) => void recorder.onIdleState(state));

    // ---- settings changes
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[SETTINGS_KEY]) return;
      const oldS = changes[SETTINGS_KEY].oldValue as Settings | undefined;
      const newS = changes[SETTINGS_KEY].newValue as Settings | undefined;
      void recorder.attention();
      void recorder.updateBadge();
      if (
        !oldS ||
        !newS ||
        oldS.claudeReadsValues !== newS.claudeReadsValues ||
        oldS.retentionDays !== newS.retentionDays
      ) {
        void recorder.pushSettingsToBridge();
      }
      if (newS?.pausedUntil && newS.pausedUntil < PAUSE_FOREVER) {
        chrome.alarms.create('resume', { when: newS.pausedUntil + 500 });
      } else {
        void chrome.alarms.clear('resume');
      }
    });

    // ---- messages from content scripts and extension pages
    chrome.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => {
      const reply = (p: Promise<unknown>) => {
        p.then(sendResponse, (err) => sendResponse({ error: (err as Error).message }));
        return true;
      };
      const fromExtensionPage =
        sender.id === chrome.runtime.id && !!sender.url?.startsWith(chrome.runtime.getURL(''));
      switch (msg?.kind) {
        case 'interaction':
          return reply(recorder.onInteraction(msg.event, sender).then(() => ({ ok: true })));
        case 'aiHealth':
          return reply(
            (async () => {
              const r = await chrome.storage.local.get(AI_HEALTH_KEY);
              const all = (r[AI_HEALTH_KEY] as Record<string, AiHealthEntry>) ?? {};
              all[msg.site] = { healthy: msg.healthy, checkedAt: Date.now(), detail: msg.detail };
              await chrome.storage.local.set({ [AI_HEALTH_KEY]: all });
              return { ok: true };
            })(),
          );
      }
      // Controls are only accepted from the extension's own pages, never from web pages.
      if (!fromExtensionPage) return false;
      switch (msg?.kind) {
        case 'getStatus':
          return reply(recorder.status());
        case 'pause':
          return reply(
            updateSettings({
              pausedUntil: msg.minutes === null ? PAUSE_FOREVER : Date.now() + msg.minutes * 60_000,
            }),
          );
        case 'resume':
          return reply(updateSettings({ pausedUntil: null }));
        case 'setSiteRecording':
          return reply(
            (async () => {
              const s = await getSettings();
              return updateSettings(
                msg.record ? includeSitePatch(msg.domain, s) : excludeSitePatch(msg.domain, s),
              );
            })(),
          );
        case 'deleteAll':
          return reply(recorder.deleteAll().then(() => ({ ok: true })));
        case 'reconnectBridge':
          return reply(
            (async () => {
              recorder.bridge.disconnect();
              const ok = await recorder.bridge.ensureConnected();
              await recorder.pushSettingsToBridge();
              await recorder.bridge.flush();
              return { ok };
            })(),
          );
        case 'flushBridge':
          return reply(recorder.bridge.flush().then(() => ({ ok: true })));
      }
      return false;
    });

    void recorder.init();
  },
});
