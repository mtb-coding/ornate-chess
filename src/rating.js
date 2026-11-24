/**
 * Older Elo helpers for games that used to be rated against the bot.
 * Bot games are no longer rated. Online bullet, blitz and rapid games use
 * Glicko-2 in src/glicko.js, and the server stores those ratings.
 * Pure functions only (no DOM, no storage), so Node tests can import them.
 *
 * Standard Elo: expected = 1 / (1 + 10^((opp - r) / 400)),
 * new = r + K * (score - expected), rounded to a whole number.
 * K is 40 for the first 20 rated games and 20 afterwards.
 */

export const START_RATING = 1200;
export const PROVISIONAL_GAMES = 10;
export const K_EARLY = 40;
export const K_LATE = 20;
export const K_EARLY_GAMES = 20;
export const MIN_RATING = 100;
/** A game that ends by resignation, agreement or timeout before this move number is treated as abandoned. */
export const MIN_FULLMOVES = 5;

export function expectedScore(rating, opponent) {
  return 1 / (1 + 10 ** ((opponent - rating) / 400));
}

/** K factor for a game, given the number of rated games played before it. */
export function kFactor(gamesBefore) {
  return gamesBefore < K_EARLY_GAMES ? K_EARLY : K_LATE;
}

/** Returns { before, after, delta, k, expected }. */
export function eloUpdate(rating, opponent, score, gamesBefore) {
  if (![0, 0.5, 1].includes(score)) throw new Error('The score must be 0, 0.5 or 1.');
  if (!Number.isFinite(rating) || !Number.isFinite(opponent)) throw new Error('Ratings must be finite numbers.');
  const k = kFactor(gamesBefore);
  const expected = expectedScore(rating, opponent);
  const after = Math.max(MIN_RATING, Math.round(rating + k * (score - expected)));
  return { before: rating, after, delta: after - rating, k, expected };
}

/** Score from the player's point of view: 1 win, 0.5 draw, 0 loss (resignation is a loss). */
export function playerScore(result, playerColor) {
  if (result === '1/2-1/2') return 0.5;
  if (result !== '1-0' && result !== '0-1') throw new Error('The result must be 1-0, 0-1 or 1/2-1/2.');
  return (result === '1-0') === (playerColor === 'w') ? 1 : 0;
}

export function isProvisional(games) { return (games || 0) < PROVISIONAL_GAMES; }

/** "1236?" while provisional, "1236" afterwards. */
export function formatRating(rating, games) {
  return `${Math.round(rating)}${isProvisional(games) ? '?' : ''}`;
}

export function formatDelta(delta) {
  return delta > 0 ? `+${delta}` : delta < 0 ? `\u2212${Math.abs(delta)}` : '\u00b10';
}

const REASONS = {
  bot: 'A game against the bot is not rated. Ratings come from online bullet, blitz and rapid games.',
  local: 'Two-player games on this device are never rated.',
  analysis: 'Analysis is never rated.',
  off: 'This game is not rated because the Rated option was turned off before it started.',
  undo: 'This game is not rated because a move was taken back with Undo.',
  hint: 'This game is not rated because a hint was used.',
  loaded: 'This game is not rated because it was loaded from the saved games library.',
  legacy: 'This game is not rated because it was started before ratings were added to the app.',
  short: 'This game is not rated because it ended by resignation, agreement or timeout before move 5, so it is treated as abandoned.',
  nolevel: 'This game is not rated because the bot level has no rating.',
};
export function reasonText(code) { return REASONS[code] || ''; }

/**
 * Decides whether a game counts for the rating.
 * meta: { mode, rated (toggle), usedUndo, usedHint, loaded, legacy, botElo }
 * end (optional): { reason, plies } where reason is the engine result reason.
 * Returns { rated, code, text }. Without `end`, it reports the status so far.
 */
export function ratedStatus(meta = {}, end = null) {
  const no = (code) => ({ rated: false, code, text: reasonText(code) });
  if (meta.mode === 'bot') return no('bot');
  if (meta.mode === 'local') return no('local');
  if (meta.mode !== 'bot') return no('analysis');
  if (meta.legacy) return no('legacy');
  if (meta.loaded) return no('loaded');
  if (!meta.rated) return no('off');
  if (meta.usedUndo) return no('undo');
  if (meta.usedHint) return no('hint');
  if (meta.botElo != null && !Number.isFinite(meta.botElo)) return no('nolevel');
  if (end) {
    const abandonable = ['resignation', 'agreement', 'timeout'].includes(end.reason);
    // A position after 8 half-moves is at move 5; fewer half-moves means the game ended before move 5.
    if (abandonable && (end.plies || 0) < (MIN_FULLMOVES - 1) * 2) return no('short');
  }
  return { rated: true, code: 'rated', text: end ? 'This game was rated.' : 'This game is rated.' };
}

/**
 * True when an unfinished game stored in the autosave would count as a loss if
 * it were discarded or replaced: a rated bot game that has reached move 5.
 */
export function autosaveForfeitsAsLoss(auto, botElo) {
  if (!auto || auto.mode !== 'bot' || !auto.game || !Array.isArray(auto.game.uci) || auto.game.resultInfo) return false;
  const meta = auto.rating && typeof auto.rating === 'object' ? auto.rating : { legacy: true };
  if (meta.recorded) return false;
  return ratedStatus({ mode: 'bot', ...meta, botElo }, { reason: 'resignation', plies: auto.game.uci.length }).rated;
}
