import { getBridgeStatus, type BridgeStatus } from '../../lib/bridgeClient';
import { send } from '../../lib/messages';
import { normalizePattern } from '../../lib/scope';
import { getSettings, updateSettings, type ScopeMode, type Settings } from '../../lib/settings';
import { $, timeAgo, toast } from '../../lib/ui';

const lines = (s: string) =>
  s
    .split(/[\n,]+/)
    .map((l) => normalizePattern(l))
    .filter(Boolean);

export function parseQueryKeys(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const line of text.split('\n')) {
    const m = /^\s*([^:\s]+)\s*:\s*(.+)$/.exec(line);
    if (!m) continue;
    const keys = m[2]
      .split(/[\s,]+/)
      .map((k) => k.trim())
      .filter(Boolean);
    if (keys.length) out[normalizePattern(m[1])] = keys;
  }
  return out;
}

function formatQueryKeys(map: Record<string, string[]>): string {
  return Object.entries(map)
    .map(([d, k]) => `${d}: ${k.join(', ')}`)
    .join('\n');
}

function fill(s: Settings): void {
  document
    .querySelectorAll<HTMLInputElement>('input[name="scope"]')
    .forEach((r) => (r.checked = r.value === s.scopeMode));
  ($('#exclude') as HTMLTextAreaElement).value = s.excludeList.join('\n');
  ($('#allow') as HTMLTextAreaElement).value = s.allowList.join('\n');
  ($('#captureValues') as HTMLInputElement).checked = s.captureValues;
  ($('#aiPromptText') as HTMLInputElement).checked = s.aiPromptText;
  ($('#claudeReadsValues') as HTMLInputElement).checked = s.claudeReadsValues;
  ($('#keepQueryKeys') as HTMLTextAreaElement).value = formatQueryKeys(s.keepQueryKeys);
  ($('#retention') as HTMLInputElement).value = String(s.retentionDays);
}

function renderBridge(b: BridgeStatus): void {
  const pill = $('#bridge-pill');
  const detail = $('#bridge-detail');
  const connected = b.state === 'connected' && !!b.lastAckTs;
  if (connected) {
    pill.className = 'pill ok';
    pill.textContent = 'Bridge connected';
    detail.textContent = `Last batch confirmed ${timeAgo(b.lastAckTs)}. Database: ${b.dbPath ?? '~/.spoor/events.db'}. Host version ${b.hostVersion ?? '?'}. ${b.pending ?? 0} events waiting.`;
  } else if (b.state === 'connected') {
    pill.className = 'pill ok';
    pill.textContent = 'Bridge reachable';
    detail.textContent = `Waiting for the first batch to be confirmed. Database: ${b.dbPath ?? '?'}.`;
  } else {
    pill.className = 'pill warn';
    pill.textContent = b.state === 'connecting' ? 'Connecting…' : 'Bridge not connected';
    detail.textContent = `${b.lastError ? `Last error: ${b.lastError}. ` : ''}${b.pending ?? 0} events are kept in the browser until it connects.`;
  }
  $('#bridge-setup').hidden = connected;
}

async function main(): Promise<void> {
  $('#ext-id').textContent = chrome.runtime.id;
  fill(await getSettings());
  renderBridge(await getBridgeStatus());
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.bridgeStatus) renderBridge(changes.bridgeStatus.newValue as BridgeStatus);
  });

  $('#save').addEventListener('click', async () => {
    const scope = (document.querySelector('input[name="scope"]:checked') as HTMLInputElement | null)
      ?.value as ScopeMode;
    const s = await updateSettings({
      scopeMode: scope ?? 'all',
      excludeList: lines(($('#exclude') as HTMLTextAreaElement).value),
      allowList: lines(($('#allow') as HTMLTextAreaElement).value),
      captureValues: ($('#captureValues') as HTMLInputElement).checked,
      aiPromptText: ($('#aiPromptText') as HTMLInputElement).checked,
      claudeReadsValues: ($('#claudeReadsValues') as HTMLInputElement).checked,
      keepQueryKeys: parseQueryKeys(($('#keepQueryKeys') as HTMLTextAreaElement).value),
      retentionDays: Number(($('#retention') as HTMLInputElement).value),
    });
    fill(s);
    if (s.scopeMode === 'allow' && !s.allowList.length)
      toast('Saved. The allowlist is empty, so nothing is recorded.');
    else toast('Settings saved');
    $('#saved').textContent = `Saved ${new Date().toLocaleTimeString()}`;
  });

  $('#reconnect').addEventListener('click', async () => {
    const r = await send<{ ok: boolean }>({ kind: 'reconnectBridge' });
    toast(r.ok ? 'Bridge connected' : 'Could not reach the bridge');
  });
  $('#sync-now').addEventListener('click', async () => {
    await send({ kind: 'flushBridge' });
    toast('Sync finished');
  });

  $('#delete-all').addEventListener('click', async () => {
    if (
      !confirm('Delete every recorded event, in the browser and in the SQLite file? This cannot be undone.')
    )
      return;
    await send({ kind: 'deleteAll' });
    toast('All data deleted');
  });
}

void main();
