// Server-side move and clock checks. Live games call these instead of
// trusting the browser.
import { Game } from '../src/engine.js';

/**
 * Play one UCI move on a Game.toJSON() value.
 * @returns {{ok:true, game:object, result:object|null} | {ok:false, error:string}}
 */
export function applyUci(json, uci) {
  if (typeof uci !== 'string' || !uci.trim()) {
    return { ok: false, error: 'A UCI move is required.' };
  }
  let game;
  try {
    game = Game.fromJSON(json);
  } catch (err) {
    return { ok: false, error: err.message };
  }
  if (game.result()) return { ok: false, error: 'The game is already over.' };
  if (game.ply !== game.length) {
    return { ok: false, error: 'The game cursor is not at the last move.' };
  }
  if (!game.playUci(uci.trim())) {
    return { ok: false, error: `The move ${uci.trim()} is not legal.` };
  }
  return { ok: true, game: game.toJSON(), result: game.result() };
}

/**
 * Fischer clock after one move. Increment is added only when time remains.
 * `turn` is the side that moved. Times are milliseconds.
 */
export function clockAfterMove({ wMs, bMs, incMs = 0, turn, elapsedMs }) {
  if (turn !== 'w' && turn !== 'b') throw new Error('turn must be w or b.');
  for (const [name, value] of [['wMs', wMs], ['bMs', bMs], ['incMs', incMs], ['elapsedMs', elapsedMs]]) {
    if (!Number.isFinite(value)) throw new Error(`${name} must be a finite number.`);
    if (value < 0) throw new Error(`${name} must not be negative.`);
  }
  const out = {
    wMs: Math.round(wMs),
    bMs: Math.round(bMs),
    incMs: Math.round(incMs),
    flagged: null,
  };
  const start = turn === 'w' ? wMs : bMs;
  const key = turn === 'w' ? 'wMs' : 'bMs';
  if (elapsedMs >= start) {
    out[key] = 0;
    out.flagged = turn;
    return out;
  }
  out[key] = Math.round(start - elapsedMs + incMs);
  return out;
}
