// A public page for one account: ratings and finished online games.
import { esc, formatDate, REASON_TEXT } from './dom.js';
import { CORNER, ICONS } from './ornament.js';
import { PACE_LABEL, PACES } from '../online-ratings.js';
import { apiBase, readAccount } from './account-client.js';

const fc = `<span class="fc tl">${CORNER}</span><span class="fc tr">${CORNER}</span><span class="fc bl">${CORNER}</span><span class="fc br">${CORNER}</span>`;
const OUTCOME = { win: 'Win', loss: 'Loss', draw: 'Draw' };

function ratingText(pace) {
  if (!pace) return '—';
  return pace.provisional ? `${pace.rating}?` : String(pace.rating);
}

function gameLine(game, showPlayer) {
  const reason = REASON_TEXT[game.reason] ? ` ${REASON_TEXT[game.reason]}` : '';
  const who = showPlayer ? `${esc(game.player)}: ` : '';
  const clock = game.clock ? `${esc(game.clock)} ${esc(game.paceLabel)}` : esc(game.paceLabel);
  return `<li><span>${who}${OUTCOME[game.outcome] || 'Game'} against ${esc(game.opponent)}${esc(reason)}. ${clock}.</span><span class="muted">${esc(formatDate(game.at))}</span></li>`;
}

function paceCards(ratings) {
  return `<div class="pace-ratings">${PACES.map((id) => {
    const pace = ratings && ratings[id];
    const label = pace && pace.provisional ? 'Provisional rating' : 'Rating';
    return `<article class="pace-card"><h3>${ICONS[id]}${PACE_LABEL[id]}</h3>
      <p class="rating-figure" aria-label="${label}">${ratingText(pace)}</p>
      <p class="muted">${pace ? `${pace.wins}–${pace.draws}–${pace.losses} in ${pace.games} games` : 'No rated games yet.'}</p>
    </article>`;
  }).join('')}</div>`;
}

export async function render(root, { rest } = {}) {
  const name = rest && rest[0] ? decodeURIComponent(rest[0]) : '';
  root.innerHTML = `<h1 class="page-title" id="title-player">Player</h1><p class="muted" role="status">The page is loading.</p>`;
  if (!name) {
    root.innerHTML = `<h1 class="page-title" id="title-player">Player</h1><p>Choose a player from the leaderboard or the following page.</p>`;
    return;
  }
  const account = readAccount();
  let body;
  try {
    const headers = account ? { authorization: `Bearer ${account.token}` } : {};
    const response = await fetch(`${apiBase()}/api/players/${encodeURIComponent(name)}`, {
      headers,
      signal: AbortSignal.timeout(4000),
    });
    body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body && body.error ? body.error : 'That player could not be loaded.');
  } catch (err) {
    if (!root.isConnected) return;
    root.innerHTML = `<h1 class="page-title" id="title-player">Player</h1><p role="alert">${esc(err.message || 'That player could not be loaded.')}</p>`;
    return;
  }
  if (!root.isConnected) return;
  const games = body.games || [];
  const follow = body.you
    ? '<p class="help">This is your public page.</p>'
    : account
      ? `<div class="btn-row"><button class="btn" type="button" data-act="${body.following ? 'unfollow' : 'follow'}">${body.following ? 'Unfollow' : 'Follow'}</button><a class="btn" href="#/messages/${encodeURIComponent(body.username)}">Message</a></div><p class="appeal-status" role="status"></p>`
      : '<p class="help"><a href="#/account">Sign in</a> to follow this player.</p>';
  root.innerHTML = `
    <h1 class="page-title" id="title-player">${esc(body.username)}</h1>
    <p class="lede">${body.followers} ${body.followers === 1 ? 'follower' : 'followers'}. Following ${body.followingCount} ${body.followingCount === 1 ? 'player' : 'players'}.</p>
    ${follow}
    ${paceCards(body.ratings)}
    <h2>Recent games</h2>
    ${games.length
      ? `<ul class="player-games">${games.map((game) => gameLine(game, false)).join('')}</ul>`
      : `<div class="frame">${fc}<div class="frame-inner"><h2>No finished games yet</h2><p>A game appears here after it finishes online.</p></div></div>`}`;
  const button = root.querySelector('button[data-act]');
  if (!button || !account) return;
  button.addEventListener('click', async () => {
    const status = root.querySelector('.appeal-status');
    const act = button.dataset.act;
    button.disabled = true;
    status.textContent = act === 'follow' ? 'The follow is being saved.' : 'The follow is being removed.';
    try {
      const response = await fetch(`${apiBase()}/api/${act}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${account.token}` },
        body: JSON.stringify({ username: body.username }),
        signal: AbortSignal.timeout(8000),
      });
      const answer = await response.json().catch(() => null);
      if (!response.ok) throw new Error(answer && answer.error ? answer.error : 'The follow could not be saved.');
      if (root.isConnected) await render(root, { rest });
    } catch (err) {
      button.disabled = false;
      status.textContent = err.message || 'The follow could not be saved.';
    }
  });
}
