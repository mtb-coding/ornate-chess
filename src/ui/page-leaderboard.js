// Three leaderboards, one for each online time control.
import { esc } from './dom.js';
import { CORNER, ICONS } from './ornament.js';
import { PACE_LABEL, PACES } from '../online-ratings.js';
import { apiBase, readAccount } from './account-client.js';

const fc = `<span class="fc tl">${CORNER}</span><span class="fc tr">${CORNER}</span><span class="fc bl">${CORNER}</span><span class="fc br">${CORNER}</span>`;

const HELP = 'Each time control has its own list. A name appears after the rating is stable, which is when the question mark is gone. The list leaves a player out after two games in that category matched the engine unusually closely. One careful game is not enough to do that. A marked game still counts toward the rating.';

function paceNav(pace) {
  return `<nav class="mode-tabs lb-paces" aria-label="Time control">${PACES.map((id) => {
    const current = id === pace ? ' aria-current="page"' : '';
    return `<a href="#/leaderboard?pace=${id}"${current}>${ICONS[id]}<span>${PACE_LABEL[id]}</span></a>`;
  }).join('')}</nav>`;
}

function youNote(pace, you) {
  if (!you) return '';
  const name = PACE_LABEL[pace].toLowerCase();
  if (you.held) {
    return `<p class="lb-you" role="status">You are not on the ${name} list. Two finished games in this category matched the engine's first choice on almost every move outside the opening. The games still count toward your rating.</p>`;
  }
  if (you.provisional) {
    return `<p class="lb-you">Your ${name} rating is still provisional, so it is not on this list.</p>`;
  }
  if (you.rank) {
    return `<p class="lb-you">You are number ${you.rank} in ${name}, on ${you.rating}.</p>`;
  }
  return '';
}

function table(players, you) {
  if (!players.length) {
    return `<div class="frame">${fc}<div class="frame-inner"><h2>No stable ratings yet</h2><p>A name appears here after a player has a stable rating in this category.</p></div></div>`;
  }
  const rows = players.map((player) => {
    const yours = you && you.username && player.username === you.username;
    return `<tr${yours ? ' class="is-you"' : ''}>
      <td class="num">${player.rank}</td>
      <td>${esc(player.username)}</td>
      <td class="num">${player.rating}</td>
      <td class="num">${player.games}<span class="muted"> · ${player.wins}–${player.draws}–${player.losses}</span></td>
    </tr>`;
  }).join('');
  return `<div class="lb-wrap"><table class="lb-table">
    <caption class="visually-hidden">Players ordered by rating</caption>
    <thead><tr><th class="num">Rank</th><th>Player</th><th class="num">Rating</th><th class="num">Games</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

export async function render(root, { query } = {}) {
  const params = query || new URLSearchParams();
  const pace = PACES.includes(params.get('pace')) ? params.get('pace') : 'blitz';
  root.innerHTML = `
    <h1 class="page-title" id="title-leaderboard">Leaderboards</h1>
    <p class="lede">${HELP}</p>
    ${paceNav(pace)}
    <p class="muted" role="status">The list is loading.</p>`;
  let body;
  try {
    const account = readAccount();
    const headers = account ? { authorization: `Bearer ${account.token}` } : {};
    const response = await fetch(`${apiBase()}/api/leaderboard?pace=${pace}`, {
      headers,
      signal: AbortSignal.timeout(4000),
    });
    body = await response.json();
    if (!response.ok) throw new Error(body && body.error ? body.error : 'The list could not be loaded.');
  } catch (err) {
    if (!root.isConnected) return;
    root.innerHTML = `
      <h1 class="page-title" id="title-leaderboard">Leaderboards</h1>
      <p class="lede">${HELP}</p>
      ${paceNav(pace)}
      <p role="alert">${esc(err.message || 'The leaderboard could not be loaded. The account server may be offline.')}</p>`;
    return;
  }
  if (!root.isConnected) return;
  const you = body.you || null;
  root.innerHTML = `
    <h1 class="page-title" id="title-leaderboard">Leaderboards</h1>
    <p class="lede">${HELP}</p>
    ${paceNav(pace)}
    ${youNote(pace, you)}
    ${table(body.players || [], you)}`;
}
