// A finished online game: step through the moves, copy the PGN, or open the review.
import { mods } from './modules.js';
import { app } from './state.js';
import { GameController } from './gameview.js';
import { esc, describeResult } from './dom.js';
import { apiBase, readAccount } from './account-client.js';

export async function render(root, { rest } = {}) {
  const id = rest && rest[0] ? decodeURIComponent(rest[0]) : '';
  root.innerHTML = `<h1 class="page-title" id="title-game">Game</h1><p class="muted" role="status">The game is loading.</p>`;
  if (!id) {
    root.innerHTML = `<h1 class="page-title" id="title-game">Game</h1><p>Choose a finished game from a player page.</p>`;
    return;
  }
  const account = readAccount();
  let body;
  try {
    const headers = account ? { authorization: `Bearer ${account.token}` } : {};
    const response = await fetch(`${apiBase()}/api/games/${encodeURIComponent(id)}`, {
      headers,
      signal: AbortSignal.timeout(8000),
    });
    body = await response.json().catch(() => null);
    if (!response.ok) throw new Error((body && body.error) || 'That game could not be loaded.');
  } catch (err) {
    if (!root.isConnected) return;
    root.innerHTML = `<h1 class="page-title" id="title-game">Game</h1><p role="alert">${esc(err.message || 'That game could not be loaded.')}</p>`;
    return;
  }
  if (!root.isConnected) return;
  const names = `${body.white} against ${body.black}`;
  const clock = body.clock ? `${body.clock} ${body.paceLabel}` : body.paceLabel;
  const sentence = describeResult({ result: body.result, reason: body.reason });
  let game;
  try {
    game = mods.engine.Game.fromJSON(body.game);
  } catch {
    root.innerHTML = `<h1 class="page-title" id="title-game">Game</h1><p role="alert">The moves could not be read.</p>`;
    return;
  }
  root.innerHTML = `
    <h1 class="page-title" id="title-game">${esc(names)}</h1>
    <p class="lede">${esc(sentence)} ${esc(clock)}.</p>
    <div class="btn-row"><button class="btn" type="button" data-act="review">Review this game</button></div>
    <div class="game-host"></div>`;
  const ctrl = new GameController({ mode: 'analysis', game, name: names });
  ctrl.orientation = body.you || 'w';
  ctrl.mount(root.querySelector('.game-host'));
  root.querySelector('[data-act="review"]').addEventListener('click', () => {
    app.pendingLoad = {
      target: 'review',
      record: { name: names, mode: 'online', playerColor: body.you || 'w', game: body.game },
    };
    location.hash = '#/review';
  });
  return () => {
    try { ctrl.destroy(); } catch { /* The board is already gone. */ }
  };
}
