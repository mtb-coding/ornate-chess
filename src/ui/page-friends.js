// Search for a player, send a friend request, and message or challenge friends.
import { esc } from './dom.js';
import { CORNER, DIVIDER, ICONS } from './ornament.js';
import { CLOCK_PRESETS, clockMark } from './clock.js';
import { apiBase, readAccount } from './account-client.js';
import { noteFriendRequests } from './friend-notice.js';

const fc = `<span class="fc tl">${CORNER}</span><span class="fc tr">${CORNER}</span><span class="fc bl">${CORNER}</span><span class="fc br">${CORNER}</span>`;
const TIMES = CLOCK_PRESETS.filter((preset) => preset.baseMs > 0);

function clocks(username) {
  return TIMES.map((preset) => {
    const mark = clockMark(preset.baseMs, preset.incMs);
    return `<button class="btn play-time" type="button" data-base="${preset.baseMs}" data-inc="${preset.incMs}" data-user="${esc(username)}" aria-label="${esc(mark.short)}, ${esc(mark.paceLabel)}">${ICONS[mark.pace]}<span class="play-time-main">${esc(mark.short)}</span><span class="play-time-pace">${esc(mark.paceLabel)}</span></button>`;
  }).join('');
}

function resultButton(player) {
  if (player.friend === 'friends') return '<span class="muted">Friends</span>';
  if (player.friend === 'outgoing') return `<button class="btn" type="button" data-decline="${esc(player.username)}">Cancel request</button>`;
  if (player.friend === 'incoming') return `<button class="btn primary" type="button" data-accept="${esc(player.username)}">Accept</button><button class="btn" type="button" data-decline="${esc(player.username)}">Decline</button>`;
  return `<button class="btn" type="button" data-request="${esc(player.username)}">Add friend</button>`;
}

async function postFriend(account, path, username) {
  const response = await fetch(`${apiBase()}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${account.token}` },
    body: JSON.stringify({ username }),
    signal: AbortSignal.timeout(8000),
  });
  const answer = await response.json().catch(() => null);
  if (!response.ok) throw new Error((answer && answer.error) || 'The friend request could not be saved.');
  return answer;
}

export async function render(root) {
  const account = readAccount();
  const savedQuery = root.dataset.friendQuery || '';
  root.innerHTML = `
    <h1 class="page-title" id="title-friends">Friends</h1>
    <p class="lede">Search for a player and send a friend request. Friends can be messaged or challenged from this list.</p>`;
  if (!account) {
    root.insertAdjacentHTML('beforeend', '<p><a href="#/account">Sign in</a> to add a friend.</p>');
    noteFriendRequests(0);
    return;
  }
  root.insertAdjacentHTML('beforeend', '<p class="muted" role="status">The list is loading.</p>');
  let body;
  try {
    const response = await fetch(`${apiBase()}/api/friends`, {
      headers: { authorization: `Bearer ${account.token}` },
      signal: AbortSignal.timeout(4000),
    });
    body = await response.json().catch(() => null);
    if (!response.ok) throw new Error((body && body.error) || 'The friend list could not be loaded.');
  } catch (err) {
    if (!root.isConnected) return;
    root.innerHTML = `
      <h1 class="page-title" id="title-friends">Friends</h1>
      <p role="alert">${esc(err.message || 'The friend list could not be loaded.')}</p>`;
    return;
  }
  if (!root.isConnected) return;
  const friends = body.friends || [];
  const incoming = body.incoming || [];
  const outgoing = body.outgoing || [];
  noteFriendRequests(incoming.length);
  const requestRows = incoming.map((player) => `<li><span>${esc(player.username)} sent you a friend request.</span><button class="btn primary" type="button" data-accept="${esc(player.username)}">Accept</button><button class="btn" type="button" data-decline="${esc(player.username)}">Decline</button></li>`).join('');
  const waitingRows = outgoing.map((player) => `<li><span>A friend request to ${esc(player.username)} is waiting.</span><button class="btn" type="button" data-decline="${esc(player.username)}">Cancel</button></li>`).join('');
  const friendRows = friends.map((player) => `<li>
    <a href="#/player/${encodeURIComponent(player.username)}">${esc(player.username)}</a>
    <div class="btn-row">
      <a class="btn" href="#/messages/${encodeURIComponent(player.username)}">Message</a>
      <button class="btn" type="button" data-challenge-open="${esc(player.username)}">Challenge</button>
      <button class="btn" type="button" data-remove="${esc(player.username)}">Remove</button>
    </div>
    <div class="friend-challenge" data-challenge-for="${esc(player.username)}" hidden>
      <fieldset><legend>Your colour</legend><div class="choice-row">
        <label class="choice"><input type="radio" name="friend-color-${esc(player.username)}" value="w"><span>White</span></label>
        <label class="choice"><input type="radio" name="friend-color-${esc(player.username)}" value="b"><span>Black</span></label>
        <label class="choice"><input type="radio" name="friend-color-${esc(player.username)}" value="random" checked><span>Random</span></label>
      </div></fieldset>
      <div class="play-times">${clocks(player.username)}</div>
      <p class="challenge-status" role="status"></p>
    </div>
  </li>`).join('');
  root.innerHTML = `
    <h1 class="page-title" id="title-friends">Friends</h1>
    <p class="lede">Search for a player and send a friend request. Friends can be messaged or challenged from this list.</p>
    <form class="follow-form" aria-label="Search for a player">
      <label for="friend-search">Username</label>
      <input id="friend-search" class="field" name="q" maxlength="24" spellcheck="false" autocomplete="off" value="${esc(savedQuery)}" required>
      <button class="btn primary" type="submit">Search</button>
    </form>
    <p class="help">Enter at least two characters. The search matches the start of a username.</p>
    <p class="friend-status" role="status"></p>
    <div class="friend-results"></div>
    ${incoming.length ? `<h2>Requests</h2><ul class="follow-list">${requestRows}</ul>` : ''}
    ${outgoing.length ? `<h2>Waiting</h2><ul class="follow-list">${waitingRows}</ul>` : ''}
    <h2>Friends</h2>
    ${friends.length
      ? `<ul class="follow-list friend-list">${friendRows}</ul>`
      : `<div class="frame">${fc}<div class="frame-inner"><h2>Nobody yet</h2><p>Search for a player to send a friend request.</p></div></div>`}`;
  const status = root.querySelector('.friend-status');
  const setStatus = (text) => { if (status) status.textContent = text; };

  async function act(path, username, pendingText) {
    setStatus(pendingText);
    await postFriend(account, path, username);
    root.dataset.friendQuery = root.querySelector('#friend-search').value.trim();
    if (root.isConnected) await render(root);
  }

  root.querySelector('.follow-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = event.currentTarget.q.value.trim();
    root.dataset.friendQuery = query;
    if (query.length < 2 || !/^[A-Za-z0-9_]+$/.test(query)) {
      setStatus('Enter at least two letters, numbers or underscores.');
      return;
    }
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    setStatus('Players are being searched.');
    try {
      const response = await fetch(`${apiBase()}/api/friends/search?q=${encodeURIComponent(query)}`, {
        headers: { authorization: `Bearer ${account.token}` },
        signal: AbortSignal.timeout(8000),
      });
      const answer = await response.json().catch(() => null);
      if (!response.ok) throw new Error((answer && answer.error) || 'The search could not be completed.');
      const players = answer.players || [];
      const box = root.querySelector('.friend-results');
      box.innerHTML = players.length
        ? `<ul class="follow-list">${players.map((player) => `<li><a href="#/player/${encodeURIComponent(player.username)}">${esc(player.username)}</a>${resultButton(player)}</li>`).join('')}</ul>`
        : '<p class="muted">No player starts with that name.</p>';
      setStatus(players.length === 1 ? '1 player found.' : `${players.length} players found.`);
      bindActions(box);
    } catch (err) {
      setStatus(err.message || 'The search could not be completed.');
    }
    button.disabled = false;
  });

  function bindActions(scope) {
    scope.querySelectorAll('[data-request]').forEach((button) => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        try { await act('/api/friends/request', button.dataset.request, 'The friend request is being sent.'); }
        catch (err) { button.disabled = false; setStatus(err.message || 'The friend request could not be sent.'); }
      });
    });
    scope.querySelectorAll('[data-accept]').forEach((button) => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        try { await act('/api/friends/accept', button.dataset.accept, 'The friend request is being accepted.'); }
        catch (err) { button.disabled = false; setStatus(err.message || 'The friend request could not be accepted.'); }
      });
    });
    scope.querySelectorAll('[data-decline]').forEach((button) => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        try { await act('/api/friends/decline', button.dataset.decline, 'The friend request is being removed.'); }
        catch (err) { button.disabled = false; setStatus(err.message || 'The friend request could not be removed.'); }
      });
    });
    scope.querySelectorAll('[data-remove]').forEach((button) => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        try { await act('/api/friends/remove', button.dataset.remove, 'This player is being removed from the friend list.'); }
        catch (err) { button.disabled = false; setStatus(err.message || 'This player could not be removed.'); }
      });
    });
  }
  bindActions(root);

  root.querySelectorAll('[data-challenge-open]').forEach((button) => {
    button.addEventListener('click', () => {
      const panel = [...root.querySelectorAll('[data-challenge-for]')].find((node) => node.dataset.challengeFor === button.dataset.challengeOpen);
      if (!panel) return;
      const open = panel.hidden;
      root.querySelectorAll('[data-challenge-for]').forEach((node) => { node.hidden = true; });
      panel.hidden = !open;
    });
  });
  root.querySelectorAll('[data-base]').forEach((clockButton) => {
    clockButton.addEventListener('click', async () => {
      const username = clockButton.dataset.user;
      const panel = clockButton.closest('[data-challenge-for]');
      const picked = panel.querySelector('input:checked');
      const line = panel.querySelector('.challenge-status');
      clockButton.disabled = true;
      line.textContent = 'The offer is being sent.';
      try {
        const response = await fetch(`${apiBase()}/api/challenges`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${account.token}` },
          body: JSON.stringify({
            username,
            baseMs: Number(clockButton.dataset.base),
            incMs: Number(clockButton.dataset.inc),
            color: picked ? picked.value : 'random',
          }),
          signal: AbortSignal.timeout(8000),
        });
        const answer = await response.json().catch(() => null);
        if (!response.ok) throw new Error((answer && answer.error) || 'The offer could not be sent.');
        const mark = clockMark(answer.baseMs, answer.incMs);
        const asked = mark ? `${mark.short} ${mark.paceLabel}` : 'listed';
        line.textContent = `You offered ${username} a ${asked} game. Waiting for a reply.`;
      } catch (err) {
        line.textContent = err.message || 'The offer could not be sent.';
      }
      clockButton.disabled = false;
    });
  });

  if (savedQuery.length >= 2) root.querySelector('.follow-form').requestSubmit();
}
