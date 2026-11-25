// A circle for a friend request that is waiting for an answer.
import { apiBase, onAccountChange, readAccount } from './account-client.js';
import { paintMessageNotice } from './message-notice.js';

const WAIT_MS = 15000;
let incoming = false;
let watching = false;
let fetchGen = 0;

function paint() {
  const root = document.documentElement;
  if (incoming) root.dataset.friendRequest = '1';
  else delete root.dataset.friendRequest;
  const link = document.querySelector('.more-nav a[data-route="friends"]');
  if (link) {
    if (incoming) link.setAttribute('aria-label', 'Friends. You have a friend request.');
    else link.removeAttribute('aria-label');
  }
  paintMessageNotice();
}

export function noteFriendRequests(count) {
  fetchGen += 1;
  incoming = Number(count) > 0;
  paint();
}

export async function refreshFriendNotice() {
  const account = readAccount();
  const gen = ++fetchGen;
  if (!account) {
    if (gen !== fetchGen) return;
    incoming = false;
    paint();
    return;
  }
  try {
    const response = await fetch(`${apiBase()}/api/friends`, {
      headers: { authorization: `Bearer ${account.token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (gen !== fetchGen) return;
    if (response.status === 401) {
      incoming = false;
      paint();
      return;
    }
    if (!response.ok) return;
    const body = await response.json();
    if (gen !== fetchGen) return;
    incoming = Array.isArray(body.incoming) && body.incoming.length > 0;
    paint();
  } catch { /* Keep the last circle when the server cannot be reached. */ }
}

export function watchFriendNotice() {
  if (watching) return;
  watching = true;
  onAccountChange(() => { refreshFriendNotice(); });
  window.addEventListener('focus', () => { refreshFriendNotice(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshFriendNotice();
  });
  window.setInterval(() => { refreshFriendNotice(); }, WAIT_MS);
  refreshFriendNotice();
}
