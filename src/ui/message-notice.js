// A circle for an unanswered message request. The burger shows it while the
// menu is closed. The Messages item shows it while the menu is open.
import { apiBase, onAccountChange, readAccount } from './account-client.js';

const WAIT_MS = 15000;
let pending = false;
let watching = false;
let fetchGen = 0;

export function noteInbox(threads) {
  fetchGen += 1;
  pending = Array.isArray(threads) && threads.some((thread) => thread && thread.status === 'incoming');
  paintMessageNotice();
}

export function paintMessageNotice() {
  const root = document.documentElement;
  if (pending) root.dataset.messageRequest = '1';
  else delete root.dataset.messageRequest;
  const toggle = document.getElementById('nav-toggle');
  const link = document.querySelector('.more-nav a[data-route="messages"]');
  if (toggle) {
    const open = toggle.getAttribute('aria-expanded') === 'true';
    if (open) toggle.setAttribute('aria-label', 'Close the menu');
    else if (pending) toggle.setAttribute('aria-label', 'More pages. You have a message request.');
    else toggle.setAttribute('aria-label', 'More pages');
  }
  if (link) {
    if (pending) link.setAttribute('aria-label', 'Messages. You have a message request.');
    else link.removeAttribute('aria-label');
  }
}

export async function refreshMessageNotice() {
  const account = readAccount();
  const gen = ++fetchGen;
  if (!account) {
    if (gen !== fetchGen) return;
    pending = false;
    paintMessageNotice();
    return;
  }
  try {
    const response = await fetch(`${apiBase()}/api/messages`, {
      headers: { authorization: `Bearer ${account.token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (gen !== fetchGen) return;
    if (response.status === 401) {
      pending = false;
      paintMessageNotice();
      return;
    }
    if (!response.ok) return;
    const body = await response.json();
    if (gen !== fetchGen) return;
    pending = Array.isArray(body.threads) && body.threads.some((thread) => thread && thread.status === 'incoming');
    paintMessageNotice();
  } catch { /* Keep the last circle when the server cannot be reached. */ }
}

export function watchMessageNotice() {
  if (watching) return;
  watching = true;
  onAccountChange(() => { refreshMessageNotice(); });
  window.addEventListener('focus', () => { refreshMessageNotice(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshMessageNotice();
  });
  window.setInterval(() => { refreshMessageNotice(); }, WAIT_MS);
  refreshMessageNotice();
}
