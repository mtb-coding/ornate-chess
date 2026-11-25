// Players the signed-in account follows, and their recent finished games.
import { esc, formatDate, REASON_TEXT } from './dom.js';
import { CORNER } from './ornament.js';
import { PACE_LABEL, PACES } from '../online-ratings.js';
import { apiBase, readAccount } from './account-client.js';

const fc = `<span class="fc tl">${CORNER}</span><span class="fc tr">${CORNER}</span><span class="fc bl">${CORNER}</span><span class="fc br">${CORNER}</span>`;
const OUTCOME = { win: 'Win', loss: 'Loss', draw: 'Draw' };

function ratingText(pace) {
  if (!pace) return '—';
  return pace.provisional ? `${pace.rating}?` : String(pace.rating);
}

export async function render(root) {
  const account = readAccount();
  root.innerHTML = `
    <h1 class="page-title" id="title-following">Following</h1>
    <p class="lede">Follow a player to keep their ratings and finished online games on this page.</p>`;
  if (!account) {
    root.insertAdjacentHTML('beforeend', '<p><a href="#/account">Sign in</a> to follow other players.</p>');
    return;
  }
  root.insertAdjacentHTML('beforeend', '<p class="muted" role="status">The list is loading.</p>');
  let body;
  try {
    const response = await fetch(`${apiBase()}/api/following`, {
      headers: { authorization: `Bearer ${account.token}` },
      signal: AbortSignal.timeout(4000),
    });
    body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body && body.error ? body.error : 'The following list could not be loaded.');
  } catch (err) {
    if (!root.isConnected) return;
    root.innerHTML = `
      <h1 class="page-title" id="title-following">Following</h1>
      <p role="alert">${esc(err.message || 'The following list could not be loaded.')}</p>`;
    return;
  }
  if (!root.isConnected) return;
  const players = body.players || [];
  const games = body.games || [];
  const rows = players.map((player) => {
    const ratings = PACES.map((id) => `${PACE_LABEL[id]} ${ratingText(player.ratings && player.ratings[id])}`).join(' · ');
    return `<li><a href="#/player/${encodeURIComponent(player.username)}">${esc(player.username)}</a><span class="muted">${esc(ratings)}</span><button class="btn" type="button" data-unfollow="${esc(player.username)}">Unfollow</button></li>`;
  }).join('');
  const gameRows = games.map((game) => {
    const reason = REASON_TEXT[game.reason] ? ` ${REASON_TEXT[game.reason]}` : '';
    const clock = game.clock ? `${esc(game.clock)} ${esc(game.paceLabel)}` : esc(game.paceLabel);
    return `<li><a href="#/game/${encodeURIComponent(game.id)}">${esc(game.player)}: ${OUTCOME[game.outcome] || 'Game'} against ${esc(game.opponent)}${esc(reason)}. ${clock}.</a><span class="muted">${esc(formatDate(game.at))}</span></li>`;
  }).join('');
  root.innerHTML = `
    <h1 class="page-title" id="title-following">Following</h1>
    <p class="lede">Follow a player to keep their ratings and finished online games on this page.</p>
    <form class="follow-form" aria-label="Follow a player">
      <label for="follow-name">Username</label>
      <input id="follow-name" class="field" name="username" maxlength="24" spellcheck="false" autocomplete="off" required>
      <button class="btn primary" type="submit">Follow</button>
    </form>
    <p class="appeal-status" role="status"></p>
    ${players.length
      ? `<ul class="follow-list">${rows}</ul>`
      : `<div class="frame">${fc}<div class="frame-inner"><h2>Nobody yet</h2><p>Enter a username to follow that player.</p></div></div>`}
    <h2>Recent games</h2>
    ${games.length ? `<ul class="player-games">${gameRows}</ul>` : '<p class="muted">Finished games from players you follow appear here.</p>'}`;
  const status = root.querySelector('.appeal-status');
  root.querySelector('.follow-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = event.currentTarget.username.value.trim();
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    status.textContent = 'The follow is being saved.';
    try {
      const response = await fetch(`${apiBase()}/api/follow`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${account.token}` },
        body: JSON.stringify({ username }),
        signal: AbortSignal.timeout(8000),
      });
      const answer = await response.json().catch(() => null);
      if (!response.ok) throw new Error(answer && answer.error ? answer.error : 'The follow could not be saved.');
      if (root.isConnected) await render(root);
    } catch (err) {
      button.disabled = false;
      status.textContent = err.message || 'The follow could not be saved.';
    }
  });
  root.querySelectorAll('[data-unfollow]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      status.textContent = 'The follow is being removed.';
      try {
        const response = await fetch(`${apiBase()}/api/unfollow`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${account.token}` },
          body: JSON.stringify({ username: button.dataset.unfollow }),
          signal: AbortSignal.timeout(8000),
        });
        const answer = await response.json().catch(() => null);
        if (!response.ok) throw new Error(answer && answer.error ? answer.error : 'The follow could not be removed.');
        if (root.isConnected) await render(root);
      } catch (err) {
        button.disabled = false;
        status.textContent = err.message || 'The follow could not be removed.';
      }
    });
  });
}
