// Online Glicko-2 ratings. One record per player for bullet, blitz and rapid.
// The numbers are stored here. A client cannot replace them through sync.
import { glickoPeriod } from '../src/glicko.js';
import { clockMark } from '../src/clock-presets.js';
import {
  PACES, applyPaceGame, blankOnlineRatings, normalizeOnlineRatings, normalizePace,
} from '../src/online-ratings.js';

const UPSERT = `
INSERT INTO pace_ratings (
  user_id, pace, rating, deviation, volatility, games, wins, draws, losses, peak,
  white_json, black_json, history_json, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(user_id, pace) DO UPDATE SET
  rating = excluded.rating,
  deviation = excluded.deviation,
  volatility = excluded.volatility,
  games = excluded.games,
  wins = excluded.wins,
  draws = excluded.draws,
  losses = excluded.losses,
  peak = excluded.peak,
  white_json = excluded.white_json,
  black_json = excluded.black_json,
  history_json = excluded.history_json,
  updated_at = excluded.updated_at
`;

function rowToPace(row) {
  let white = null;
  let black = null;
  let history = [];
  try { white = JSON.parse(row.white_json); } catch { white = null; }
  try { black = JSON.parse(row.black_json); } catch { black = null; }
  try { history = JSON.parse(row.history_json); } catch { history = []; }
  return normalizePace({
    rating: row.rating,
    deviation: row.deviation,
    volatility: row.volatility,
    games: row.games,
    wins: row.wins,
    draws: row.draws,
    losses: row.losses,
    peak: row.peak,
    white,
    black,
    history,
  });
}

export function readRatings(db, userId) {
  const doc = blankOnlineRatings();
  const rows = db.prepare('SELECT * FROM pace_ratings WHERE user_id = ?').all(userId);
  for (const row of rows) {
    if (PACES.includes(row.pace)) doc[row.pace] = rowToPace(row);
  }
  return normalizeOnlineRatings(doc);
}

function writePace(db, userId, pace, record, now) {
  db.prepare(UPSERT).run(
    userId,
    pace,
    record.rating,
    record.deviation,
    record.volatility,
    record.games,
    record.wins,
    record.draws,
    record.losses,
    record.peak,
    JSON.stringify(record.white),
    JSON.stringify(record.black),
    JSON.stringify(record.history),
    now,
  );
}

function summary(pace, before, after) {
  return {
    pace,
    before: before.rating,
    after: after.rating,
    delta: Math.round(after.rating) - Math.round(before.rating),
    deviation: after.deviation,
    games: after.games,
    provisional: after.provisional,
    wins: after.wins,
    draws: after.draws,
    losses: after.losses,
    peak: after.peak,
  };
}

/**
 * Score one finished game for both players, using each rating from before
 * the game. result is 1-0, 0-1 or 1/2-1/2. Returns a summary for each id,
 * including that player's full rating document.
 */
export function rateGame(db, { pace, whiteId, blackId, result, now, whiteName, blackName }) {
  if (!PACES.includes(pace)) throw new Error('The pace must be bullet, blitz or rapid.');
  if (result !== '1-0' && result !== '0-1' && result !== '1/2-1/2') return null;
  const whiteDoc = readRatings(db, whiteId);
  const blackDoc = readRatings(db, blackId);
  const whiteBefore = whiteDoc[pace];
  const blackBefore = blackDoc[pace];
  const whiteScore = result === '1-0' ? 1 : result === '0-1' ? 0 : 0.5;
  const whiteNext = glickoPeriod(whiteBefore, [{ rating: blackBefore.rating, deviation: blackBefore.deviation, score: whiteScore }]);
  const blackNext = glickoPeriod(blackBefore, [{ rating: whiteBefore.rating, deviation: whiteBefore.deviation, score: 1 - whiteScore }]);
  whiteDoc[pace] = applyPaceGame(whiteBefore, {
    next: whiteNext, score: whiteScore, color: 'w', opponent: blackBefore, opponentName: blackName, at: now,
  });
  blackDoc[pace] = applyPaceGame(blackBefore, {
    next: blackNext, score: 1 - whiteScore, color: 'b', opponent: whiteBefore, opponentName: whiteName, at: now,
  });
  db.exec('BEGIN IMMEDIATE');
  try {
    writePace(db, whiteId, pace, whiteDoc[pace], now);
    writePace(db, blackId, pace, blackDoc[pace], now);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  const white = summary(pace, whiteBefore, whiteDoc[pace]);
  const black = summary(pace, blackBefore, blackDoc[pace]);
  white.document = whiteDoc;
  black.document = blackDoc;
  return { [whiteId]: white, [blackId]: black };
}

/** Pace for a live game, or null when the clock is not one of the three. */
export function paceForClock(baseMs, incMs) {
  const mark = clockMark(baseMs, incMs);
  return mark ? mark.pace : null;
}
