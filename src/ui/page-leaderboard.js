// Three leaderboards, one for each online time control.
import { esc } from './dom.js';
import { CORNER, ICONS } from './ornament.js';
import { PACE_LABEL, PACES } from '../online-ratings.js';
import { apiBase, readAccount } from './account-client.js';

const fc = `<span class="fc tl">${CORNER}</span><span class="fc tr">${CORNER}</span><span class="fc bl">${CORNER}</span><span class="fc br">${CORNER}</span>`;

const HELP = 'Each time control has its own list. A name appears after the rating is stable, which is when the question mark is gone. The list leaves a player out after two games in that category matched the engine unusually closely. Move times are kept with those games. An appeal looks at that pace and can restore the name when the moves were not played at a steady, very fast pace. The appeal is decided from the move times. It is not read by a person. One careful game is not enough. A marked game still counts toward the rating.';

function paceNav(pace) {
  return `<nav class="mode-tabs lb-paces" aria-label="Time control">${PACES.map((id) => {
    const current = id === pace ? ' aria-current="page"' : '';
    return `<a href="#/leaderboard?pace=${id}"${current}>${ICONS[id]}<span>${PACE_LABEL[id]}</span></a>`;
  }).join('')}</nav>`;
}

function appealBlock(you) {
  if (!you) return '';
  if (you.canAppeal) {
    return `<form class="appeal-form" aria-label="Appeal">
      <label for="appeal-note">Note, optional</label>
      <textarea id="appeal-note" class="field" name="note" maxlength="400"></textarea>
      <p class="help">The check looks at how quickly the marked moves were played. It does not change the rating. A declined appeal stays until another game is marked.</p>
      <div class="btn-row"><button class="btn" type="submit">Send the appeal</button></div>
      <p class="appeal-status" role="status"></p>
    </form>`;
  }
  if (you.appeal && you.appeal.decision) return `<p class="lb-you">${esc(you.appeal.decision)}</p>`;
  return '';
}

function youNote(pace, you) {
  if (!you) return '';
  const name = PACE_LABEL[pace].toLowerCase();
  const appeal = appealBlock(you);
  if (you.held) {
    return `<p class="lb-you" role="status">You are not on the ${name} list. Two finished games in this category matched the engine's first choice on almost every move outside the opening. The games still count toward your rating.</p>${appeal}`;
  }
  if (you.provisional) {
    return `<p class="lb-you">Your ${name} rating is still provisional, so it is not on this list.</p>${appeal}`;
  }
  if (you.rank) {
    return `<p class="lb-you">You are number ${you.rank} in ${name}, on ${you.rating}.</p>${appeal}`;
  }
  return appeal;
}

function table(players, you) {
  if (!players.length) {
    return `<div class="frame">${fc}<div class="frame-inner"><h2>No stable ratings yet</h2><p>A name appears here after a player has a stable rating in this category.</p></div></div>`;
  }
  const rows = players.map((player) => {
    const yours = you && you.username && player.username === you.username;
    return `<tr${yours ? ' class="is-you"' : ''}>
      <td class="num">${player.rank}</td>
      <td><a href="#/player/${encodeURIComponent(player.username)}">${esc(player.username)}</a></td>
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
  const form = root.querySelector('.appeal-form');
  if (!form) return;
  const account = readAccount();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = form.querySelector('.appeal-status');
    const button = form.querySelector('button');
    if (!account) {
      status.textContent = 'Sign in before sending an appeal.';
      return;
    }
    button.disabled = true;
    status.textContent = 'The appeal is being checked.';
    try {
      const response = await fetch(`${apiBase()}/api/appeals`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${account.token}` },
        body: JSON.stringify({ pace, note: form.note.value }),
        signal: AbortSignal.timeout(8000),
      });
      const answer = await response.json().catch(() => null);
      if (!response.ok) throw new Error(answer && answer.error ? answer.error : 'The appeal could not be sent.');
      if (root.isConnected) await render(root, { query: params });
    } catch (err) {
      button.disabled = false;
      status.textContent = err.message || 'The appeal could not be sent.';
    }
  });
}
