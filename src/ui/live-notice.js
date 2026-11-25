// A line above the page when a live game or an incoming challenge is waiting.
import { apiBase, onAccountChange, readAccount } from './account-client.js';
import { esc } from './dom.js';

const WAIT_MS = 15000;
let watching = false;
let fetchGen = 0;

function onPlay() {
  const path = (location.hash || '').replace(/^#/, '').split('?')[0];
  return path.replace(/^\//, '').split('/')[0] === 'play';
}

function bar() {
  let node = document.getElementById('live-notice');
  if (node) return node;
  node = document.createElement('p');
  node.id = 'live-notice';
  node.className = 'live-notice';
  node.hidden = true;
  node.setAttribute('role', 'status');
  const main = document.getElementById('main');
  if (main && main.parentNode) main.parentNode.insertBefore(node, main);
  return node;
}

function hide(node) {
  node.hidden = true;
  node.textContent = '';
}

export function noteLiveBoard() {
  const node = document.getElementById('live-notice');
  if (node && document.querySelector('[data-live-game]')) hide(node);
}

function paint(state) {
  const node = bar();
  if (!node) return;
  const playing = Boolean(document.querySelector('[data-live-game]'));
  const game = state && state.game;
  const incoming = state && Array.isArray(state.incoming) && state.incoming[0];
  if (game && !playing) {
    node.hidden = false;
    node.innerHTML = `You are in a game against ${esc(game.opponent)}. <a href="#/play">Return to Play to reconnect.</a>`;
    return;
  }
  if (!game && incoming && !onPlay()) {
    node.hidden = false;
    node.innerHTML = `${esc(incoming.username)} offered you a game. <a href="#/play?lobby=1">Return to Play to answer.</a>`;
    return;
  }
  hide(node);
}

export async function refreshLiveNotice() {
  const account = readAccount();
  const gen = ++fetchGen;
  if (!account) {
    if (gen === fetchGen) paint(null);
    return;
  }
  try {
    const response = await fetch(`${apiBase()}/api/live`, {
      headers: { authorization: `Bearer ${account.token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (gen !== fetchGen) return;
    if (response.status === 401) {
      paint(null);
      return;
    }
    if (!response.ok) return;
    const body = await response.json();
    if (gen !== fetchGen) return;
    paint(body);
  } catch { /* The next poll tries again. */ }
}

export function watchLiveNotice() {
  if (watching) return;
  watching = true;
  const tick = () => { refreshLiveNotice(); };
  window.setInterval(tick, WAIT_MS);
  window.addEventListener('focus', tick);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });
  window.addEventListener('hashchange', tick);
  onAccountChange(tick);
  tick();
}
