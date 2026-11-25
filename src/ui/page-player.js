// A public page for one account: ratings and finished online games.
import { esc, formatDate, REASON_TEXT } from './dom.js';
import { CORNER, DIVIDER, ICONS } from './ornament.js';
import { PACE_LABEL, PACES } from '../online-ratings.js';
import { CLOCK_PRESETS, clockMark } from './clock.js';
import { apiBase, readAccount } from './account-client.js';
import { refreshFriendNotice } from './friend-notice.js';

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
  const href = `#/game/${encodeURIComponent(game.id)}`;
  return `<li><a href="${href}">${who}${OUTCOME[game.outcome] || 'Game'} against ${esc(game.opponent)}${esc(reason)}. ${clock}.</a><span class="muted">${esc(formatDate(game.at))}</span></li>`;
}

function friendButtons(friend) {
  if (friend === 'friends') return '<button class="btn" type="button" data-friend="remove">Remove friend</button>';
  if (friend === 'outgoing') return '<button class="btn" type="button" data-friend="decline">Cancel request</button>';
  if (friend === 'incoming') return '<button class="btn primary" type="button" data-friend="accept">Accept friend request</button><button class="btn" type="button" data-friend="decline">Decline</button>';
  return '<button class="btn" type="button" data-friend="request">Add friend</button>';
}

function challengePanel() {
  const times = CLOCK_PRESETS.filter((preset) => preset.baseMs > 0).map((preset) => {
    const mark = clockMark(preset.baseMs, preset.incMs);
    return `<button class="btn play-time" type="button" data-base="${preset.baseMs}" data-inc="${preset.incMs}" aria-label="${esc(mark.short)}, ${esc(mark.paceLabel)}">${ICONS[mark.pace]}<span class="play-time-main">${esc(mark.short)}</span><span class="play-time-pace">${esc(mark.paceLabel)}</span></button>`;
  }).join('');
  return `<div class="frame setup-card challenge-panel">${fc}<div class="frame-inner">
    <h2>Challenge</h2>
    ${DIVIDER}
    <p class="help">Ask this player for a game on one of the listed time controls. The game starts when they accept.</p>
    <fieldset><legend>Your colour</legend><div class="choice-row">
      <label class="choice"><input type="radio" name="challenge-color" value="w"><span><span class="pb-dot w" aria-hidden="true"></span>White</span></label>
      <label class="choice"><input type="radio" name="challenge-color" value="b"><span><span class="pb-dot b" aria-hidden="true"></span>Black</span></label>
      <label class="choice"><input type="radio" name="challenge-color" value="random" checked><span>Random</span></label>
    </div></fieldset>
    <div class="play-times">${times}</div>
    <p class="challenge-status" role="status"></p>
  </div></div>`;
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
      ? `<div class="btn-row"><button class="btn" type="button" data-act="${body.following ? 'unfollow' : 'follow'}">${body.following ? 'Unfollow' : 'Follow'}</button>${friendButtons(body.friend)}<a class="btn" href="#/messages/${encodeURIComponent(body.username)}">Message</a></div><p class="appeal-status" role="status"></p>${challengePanel()}`
      : '<p class="help"><a href="#/account">Sign in</a> to follow, add a friend, or challenge this player.</p>';
  root.innerHTML = `
    <h1 class="page-title" id="title-player">${esc(body.username)}</h1>
    <p class="lede">${body.followers} ${body.followers === 1 ? 'follower' : 'followers'}. Following ${body.followingCount} ${body.followingCount === 1 ? 'player' : 'players'}.</p>
    ${follow}
    ${paceCards(body.ratings)}
    <h2>Recent games</h2>
    ${games.length
      ? `<ul class="player-games">${games.map((game) => gameLine(game, false)).join('')}</ul>`
      : `<div class="frame">${fc}<div class="frame-inner"><h2>No finished games yet</h2><p>A game appears here after it finishes online.</p></div></div>`}`;
  root.querySelectorAll('[data-base]').forEach((clockButton) => {
    clockButton.addEventListener('click', async () => {
      if (!account) return;
      const status = root.querySelector('.challenge-status');
      const picked = root.querySelector('input[name="challenge-color"]:checked');
      clockButton.disabled = true;
      status.textContent = 'The offer is being sent.';
      try {
        const response = await fetch(`${apiBase()}/api/challenges`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${account.token}` },
          body: JSON.stringify({
            username: body.username,
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
        status.textContent = `You offered ${body.username} a ${asked} game. Waiting for a reply.`;
      } catch (err) {
        status.textContent = err.message || 'The offer could not be sent.';
      }
      clockButton.disabled = false;
    });
  });
  root.querySelectorAll('[data-friend]').forEach((friendButton) => {
    friendButton.addEventListener('click', async () => {
      const status = root.querySelector('.appeal-status');
      const act = friendButton.dataset.friend;
      const path = act === 'request' ? '/api/friends/request'
        : act === 'accept' ? '/api/friends/accept'
          : act === 'decline' ? '/api/friends/decline'
            : '/api/friends/remove';
      const pending = act === 'request' ? 'The friend request is being sent.'
        : act === 'accept' ? 'The friend request is being accepted.'
          : act === 'remove' ? 'This player is being removed from the friend list.'
            : 'The friend request is being removed.';
      friendButton.disabled = true;
      status.textContent = pending;
      try {
        const response = await fetch(`${apiBase()}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${account.token}` },
          body: JSON.stringify({ username: body.username }),
          signal: AbortSignal.timeout(8000),
        });
        const answer = await response.json().catch(() => null);
        if (!response.ok) throw new Error((answer && answer.error) || 'The friend request could not be saved.');
        refreshFriendNotice();
        if (root.isConnected) await render(root, { rest });
      } catch (err) {
        friendButton.disabled = false;
        status.textContent = err.message || 'The friend request could not be saved.';
      }
    });
  });
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
