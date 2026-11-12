import { defineContentScript } from 'wxt/utils/define-content-script';
import { adapterForHost, createHealthCheck, HEALTH_WAIT_SECONDS } from '../adapters';
import { AI_TEXT_MAX_CHARS } from '../lib/constants';
import { installCapture } from '../lib/capture';
import type { Message } from '../lib/messages';
import type { CapturedInteraction } from '../lib/schema';
import { isInScope, isPaused } from '../lib/scope';
import { DEFAULT_SETTINGS, getSettings, onSettingsChanged, type Settings } from '../lib/settings';
import { templateUrl } from '../lib/urlTemplate';

/** Once a page is judged, look again this often: composers load late and views change without a page load. */
const HEALTH_RECHECK_MS = 5000;

/**
 * Runs on every site. The scope module decides at runtime whether this page is recorded.
 * Never records anything in incognito (the extension is not allowed there, and the
 * background worker double checks).
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  allFrames: false,
  async main() {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    if (chrome.extension?.inIncognitoContext) return;

    let settings: Settings = DEFAULT_SETTINGS;
    try {
      settings = await getSettings();
    } catch {}
    onSettingsChanged((s) => (settings = s));

    const enabled = () => !isPaused(settings) && isInScope(templateUrl(location.href).domain, settings);
    const post = (msg: Message) => {
      try {
        chrome.runtime.sendMessage(msg).catch(() => {});
      } catch {
        // Extension reloaded or updated: this page keeps an orphaned script until it is reloaded.
      }
    };
    const send = (event: CapturedInteraction) => post({ kind: 'interaction', event });

    const adapter = adapterForHost(location.hostname);

    installCapture(document, {
      send,
      enabled,
      captureValues: () => settings.captureValues,
      isPromptElement: adapter ? (el) => adapter.isPromptElement(el) : undefined,
    });

    if (!adapter) return;

    adapter.onPrompt((text) => {
      if (!enabled()) return;
      send({
        type: 'ai_prompt',
        ts: Date.now(),
        url: location.href,
        title: document.title,
        ai: {
          site: adapter.site,
          chars: text.length,
          text: settings.aiPromptText ? text.slice(0, AI_TEXT_MAX_CHARS) : undefined,
        },
      });
      report(true);
    });

    // Health check: where a prompt box is expected, it should appear within a few seconds.
    let lastReported: boolean | null = null;
    const report = (healthy: boolean, detail?: string) => {
      if (healthy === lastReported) return;
      lastReported = healthy;
      post({ kind: 'aiHealth', site: adapter.site, healthy, detail });
    };
    const step = createHealthCheck(adapter, () => location.pathname);
    const check = () => {
      const state = step();
      if (state === 'healthy') report(true);
      else if (state === 'broken')
        report(
          false,
          `Prompt box not found on ${templateUrl(location.href).urlTemplate} after ${HEALTH_WAIT_SECONDS} seconds`,
        );
      setTimeout(check, state === 'waiting' ? 1000 : HEALTH_RECHECK_MS);
    };
    const start = () => setTimeout(check, 1000);
    if (document.readyState === 'loading')
      document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  },
});
