import { send, type StatusResponse } from '../../lib/messages';
import { $, pausedLabel, timeAgo } from '../../lib/ui';

async function render(): Promise<void> {
  const st = await send<StatusResponse>({ kind: 'getStatus' });

  const state = $('#state');
  // Pages that are not web pages are never recorded; the pill reflects the site scope only for web pages.
  const siteOn = st.currentSite?.recordable ? st.currentSite.inScope : true;
  const rec = st.recording && siteOn;
  state.className = `pill ${rec ? 'rec' : 'off'}`;
  $('#state-text').textContent = rec ? 'REC' : 'OFF';

  const site = $('#site');
  const toggle = $('#site-toggle') as HTMLButtonElement;
  if (!st.currentSite || !st.currentSite.recordable) {
    site.textContent = 'Not a web page (never recorded)';
    toggle.hidden = true;
  } else {
    site.textContent = st.currentSite.domain;
    toggle.hidden = false;
    toggle.textContent = st.currentSite.inScope ? 'Exclude this site' : 'Record this site';
    toggle.onclick = async () => {
      await send({
        kind: 'setSiteRecording',
        domain: st.currentSite!.domain,
        record: !st.currentSite!.inScope,
      });
      await render();
    };
  }

  $('#count-today').textContent = st.counts.today.toLocaleString();
  $('#count-total').textContent = st.counts.total.toLocaleString();
  $('#count-unsynced').textContent = st.counts.unsynced.toLocaleString();

  $('#paused-text').textContent = st.paused ? pausedLabel(st.pausedUntil) : '';
  $('#pause-buttons').hidden = st.paused;
  $('#resume').hidden = !st.paused;

  const b = $('#bridge');
  if (st.bridge.state === 'connected') {
    b.className = 'pill ok';
    b.textContent = `Bridge connected · last sync ${timeAgo(st.bridge.lastAckTs)}`;
  } else {
    b.className = 'pill warn';
    b.textContent = 'Bridge not connected · data stays in the browser';
    b.title = st.bridge.lastError ?? '';
  }
}

document.querySelectorAll<HTMLButtonElement>('[data-pause]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const v = btn.dataset.pause!;
    await send({ kind: 'pause', minutes: v === 'forever' ? null : Number(v) });
    await render();
  });
});
$('#resume').addEventListener('click', async () => {
  await send({ kind: 'resume' });
  await render();
});
$('#open-dashboard').addEventListener('click', () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('/dashboard.html') });
  window.close();
});
$('#open-options').addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
  window.close();
});

void render();
