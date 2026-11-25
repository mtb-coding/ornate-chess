// A circle for an unanswered message request, or a new message in a
// conversation that is already open. The burger shows it while the menu is
// closed. The Messages item shows it while the menu is open.
import { apiBase, onAccountChange, readAccount } from './account-client.js';

const WAIT_MS = 15000;
const SEEN_KEY = 'ornate-chess:message-seen';
let pending = false;
let noticeKind = '';
let watching = false;
let fetchGen = 0;

function readSeen() {
  try {
    const value = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

export function markThreadSeen(username, at) {
  if (typeof username !== 'string' || !username || !Number.isFinite(at)) return;
  const map = readSeen();
  const key = username.toLowerCase();
  if (map[key] === at) return;
  map[key] = at;
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(map)); } catch { /* This browser may block storage. */ }
}

function openThreadName() {
  const path = (location.hash || '').replace(/^#/, '').split('?')[0];
  const parts = path.split('/').filter(Boolean);
  if (parts[0] !== 'messages' || !parts[1]) return '';
  try { return decodeURIComponent(parts[1]).toLowerCase(); } catch { return ''; }
}

function unreadKind(threads) {
  const openName = openThreadName();
  const list = Array.isArray(threads) ? threads : [];
  if (openName) {
    const current = list.find((thread) => thread && String(thread.username || '').toLowerCase() === openName);
    if (current && Number.isFinite(current.lastAt)) markThreadSeen(current.username, current.lastAt);
  }
  const seen = readSeen();
  let request = false;
  let message = false;
  for (const thread of list) {
    if (!thread) continue;
    if (openName && String(thread.username || '').toLowerCase() === openName) continue;
    if (thread.status === 'incoming') request = true;
    else if (thread.status === 'open' && thread.lastYours === false && Number.isFinite(thread.lastAt)) {
      const previous = Number(seen[String(thread.username).toLowerCase()] || 0);
      if (thread.lastAt > previous) message = true;
    }
  }
  return { pending: request || message, kind: message ? 'message' : request ? 'request' : '' };
}

function applyInbox(threads) {
  const next = unreadKind(threads);
  pending = next.pending;
  noticeKind = next.kind;
  paintMessageNotice();
}

export function noteInbox(threads) {
  fetchGen += 1;
  applyInbox(threads);
}

function noticeSentence() {
  return noticeKind === 'message' ? 'You have a new message.' : 'You have a message request.';
}

export function paintMessageNotice() {
  const root = document.documentElement;
  if (pending) root.dataset.messageRequest = '1';
  else delete root.dataset.messageRequest;
  const toggle = document.getElementById('nav-toggle');
  const link = document.querySelector('.more-nav a[data-route="messages"]');
  const sentence = noticeSentence();
  const friendWaiting = root.dataset.friendRequest === '1';
  const parts = [];
  if (pending) parts.push(sentence);
  if (friendWaiting) parts.push('You have a friend request.');
  if (toggle) {
    const open = toggle.getAttribute('aria-expanded') === 'true';
    if (open) toggle.setAttribute('aria-label', 'Close the menu');
    else if (parts.length) toggle.setAttribute('aria-label', `More pages. ${parts.join(' ')}`);
    else toggle.setAttribute('aria-label', 'More pages');
  }
  if (link) {
    if (pending) link.setAttribute('aria-label', `Messages. ${sentence}`);
    else link.removeAttribute('aria-label');
  }
}

export async function refreshMessageNotice() {
  const account = readAccount();
  const gen = ++fetchGen;
  if (!account) {
    if (gen !== fetchGen) return;
    pending = false;
    noticeKind = '';
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
      noticeKind = '';
      paintMessageNotice();
      return;
    }
    if (!response.ok) return;
    const body = await response.json();
    if (gen !== fetchGen) return;
    applyInbox(body.threads);
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
