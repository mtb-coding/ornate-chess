// Engine-agreement check for finished online games, and the three pace lists.
// A single careful game is not enough. Two marked games in one pace leave
// that player off that pace's list. The rating itself is not changed.
import { PROVISIONAL_DEVIATION } from '../src/glicko.js';
import { PACES } from '../src/online-ratings.js';
import { HttpError } from './errors.mjs';

export const CHEAT_MIN_MOVES = 15;
export const CHEAT_MATCH_RATE = 0.9;
export const CHEAT_MAX_AVERAGE_LOSS = 2;
export const CHEAT_HIDE_AFTER = 2;
const LIST_LIMIT = 100;

/** Moves outside the opening, with a real choice, compared with the engine's first move. */
export function assessColor(moves, color) {
  const considered = (moves || []).filter((move) => move
    && move.color === color
    && !move.isBook
    && !move.forced
    && move.legalCount > 1
    && move.bestUci);
  const matches = considered.filter((move) => move.uci === move.bestUci).length;
  const averageLoss = considered.length
    ? considered.reduce((sum, move) => sum + (Number(move.loss) || 0), 0) / considered.length
    : null;
  const flagged = considered.length >= CHEAT_MIN_MOVES
    && matches / considered.length >= CHEAT_MATCH_RATE
    && averageLoss != null
    && averageLoss <= CHEAT_MAX_AVERAGE_LOSS;
  return { color, moves: considered.length, matches, averageLoss, flagged };
}

export function recordCheatFlags(db, { gameId, whiteId, blackId, pace, moves, now = Date.now() } = {}) {
  if (!PACES.includes(pace)) return { flags: 0 };
  const reports = [
    { userId: whiteId, ...assessColor(moves, 'w') },
    { userId: blackId, ...assessColor(moves, 'b') },
  ];
  db.exec('BEGIN IMMEDIATE');
  try {
    let flags = 0;
    const remove = db.prepare('DELETE FROM cheat_flags WHERE game_id = ? AND user_id = ?');
    const insert = db.prepare(`INSERT INTO cheat_flags (
      game_id, user_id, pace, color, moves, matches, average_loss, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const report of reports) {
      if (!report.userId) continue;
      remove.run(gameId, report.userId);
      if (!report.flagged) continue;
      insert.run(
        gameId,
        report.userId,
        pace,
        report.color,
        report.moves,
        report.matches,
        report.averageLoss,
        now,
      );
      flags += 1;
    }
    db.exec('COMMIT');
    return { flags };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function eligibleSql() {
  return `pr.deviation <= ${PROVISIONAL_DEVIATION}
    AND (
      SELECT COUNT(*) FROM cheat_flags f
      WHERE f.user_id = pr.user_id AND f.pace = pr.pace
    ) < ${CHEAT_HIDE_AFTER}`;
}

export function leaderboard(db, pace, userId = null) {
  if (!PACES.includes(pace)) throw new HttpError(400, 'Choose bullet, blitz or rapid.');
  const rows = db.prepare(`
    SELECT u.username, pr.rating, pr.games, pr.wins, pr.draws, pr.losses
    FROM pace_ratings pr
    JOIN users u ON u.id = pr.user_id
    WHERE pr.pace = ? AND ${eligibleSql()}
    ORDER BY pr.rating DESC, u.username COLLATE NOCASE
    LIMIT ${LIST_LIMIT}
  `).all(pace);
  const players = rows.map((row, index) => ({
    rank: index + 1,
    username: row.username,
    rating: Math.round(row.rating),
    games: row.games,
    wins: row.wins,
    draws: row.draws,
    losses: row.losses,
  }));
  let you = null;
  if (userId) {
    const user = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
    const mine = db.prepare('SELECT rating, deviation, games FROM pace_ratings WHERE user_id = ? AND pace = ?').get(userId, pace);
    const marks = db.prepare('SELECT COUNT(*) AS n FROM cheat_flags WHERE user_id = ? AND pace = ?').get(userId, pace);
    const held = (marks ? marks.n : 0) >= CHEAT_HIDE_AFTER;
    const stable = !!(mine && mine.deviation <= PROVISIONAL_DEVIATION);
    let rank = null;
    if (user && stable && !held) {
      const ahead = db.prepare(`
        SELECT COUNT(*) AS n
        FROM pace_ratings pr
        WHERE pr.pace = ? AND pr.rating > ? AND ${eligibleSql()}
      `).get(pace, mine.rating);
      rank = (ahead ? ahead.n : 0) + 1;
    }
    you = {
      username: user ? user.username : '',
      held,
      provisional: !stable,
      rank,
      rating: stable ? Math.round(mine.rating) : null,
      games: mine ? mine.games : 0,
    };
  }
  return { pace, players, you };
}
